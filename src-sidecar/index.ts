import { WebSocketServer } from 'ws';
import * as http from 'http';
import express from 'express';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let globalBrowserSession: BrowserSession | null = null;

import { OnnxOcrAdapter } from './ocr/onnxAdapter';
import { OcrPipeline } from './ocr/pipeline';

const ocrEngine = new OnnxOcrAdapter();
let ocrPipeline: OcrPipeline | null = null;
ocrEngine.init().then(() => {
    ocrPipeline = new OcrPipeline(ocrEngine);
    console.log("OCR Pipeline Initialized");
}).catch(console.error);

wss.on('connection', (ws) => {
    console.log('Tauri backend connected to Sidecar.');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log('Received command:', data.command);

            if (data.command === 'run_openai_agent') {
                ws.send(JSON.stringify({ status: 'running', agent: 'openai', task: data.task }));
                setTimeout(() => {
                    ws.send(JSON.stringify({ status: 'complete', result: 'OpenAI Agent completed the task: ' + data.task }));
                }, 2000);
            } 
            else if (data.command === 'run_claude_agent') {
                ws.send(JSON.stringify({ status: 'running', agent: 'claude', task: data.task }));
                setTimeout(() => {
                    ws.send(JSON.stringify({ status: 'complete', result: 'Claude Agent completed the task: ' + data.task }));
                }, 2000);
            }
            else if (data.command === 'browser_action') {
                if (!globalBrowserSession) {
                    globalBrowserSession = new BrowserSession();
                    await globalBrowserSession.launch(true);
                }
                const result = await handleBrowserAction(globalBrowserSession, data.action, data.args);
                ws.send(JSON.stringify({ command: 'browser_action', status: 'complete', result }));
            }
            else {
                ws.send(JSON.stringify({ error: 'Unknown command' }));
            }
        } catch (e: any) {
            ws.send(JSON.stringify({ error: e.message }));
        }
    });
});

app.post('/browser_action', async (req, res) => {
    try {
        const { action, args } = req.body;
        if (!globalBrowserSession) {
            globalBrowserSession = new BrowserSession();
            await globalBrowserSession.launch(true);
        }
        const result = await handleBrowserAction(globalBrowserSession, action, args);
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/ocr', async (req, res) => {
    try {
        const { image_base64 } = req.body;
        if (!ocrPipeline) throw new Error("OCR Pipeline not ready");

        const buffer = Buffer.from(image_base64, 'base64');
        const observation = await ocrPipeline.run(buffer, 1920, 1080);

        const uiElements = observation.regions.map((r, i) => ({
            ref_id: `ocr_region_${i}_${Date.now()}`,
            name: r.text,
            control_type: 'Type_Text',
            automation_id: `ocr_id_${i}`,
            is_enabled: true,
            is_keyboard_focusable: false,
            translated_text: null,
            source: 'ocr'
        }));

        res.json(uiElements);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

async function handleBrowserAction(session: BrowserSession, action: string, args: any) {
    if (!session.page) {
        throw new Error("No active page.");
    }
    const page = session.page;
    let stateChanged = true;
    let errorMsg = null;
    const startTime = Date.now();

    try {
        switch (action) {
            case 'navigate':
                await page.goto(args.url, { waitUntil: 'networkidle' });
                break;
            case 'back':
                await page.goBack({ waitUntil: 'networkidle' });
                break;
            case 'forward':
                await page.goForward({ waitUntil: 'networkidle' });
                break;
            case 'reload':
                await page.reload({ waitUntil: 'networkidle' });
                break;
            case 'click':
                await page.click(`[data-whim-ref="${args.ref}"]`, { timeout: 5000 });
                break;
            case 'type':
                await page.type(`[data-whim-ref="${args.ref}"]`, args.text);
                break;
            case 'fill':
                await page.fill(`[data-whim-ref="${args.ref}"]`, args.text);
                break;
            case 'select':
                await page.selectOption(`[data-whim-ref="${args.ref}"]`, args.value);
                break;
            case 'check':
                await page.check(`[data-whim-ref="${args.ref}"]`);
                break;
            case 'uncheck':
                await page.uncheck(`[data-whim-ref="${args.ref}"]`);
                break;
            case 'press':
                await page.keyboard.press(args.key);
                break;
            case 'captureScreenshot':
                const path = require('path');
                const os = require('os');
                const screenshotPath = path.join(os.tmpdir(), `whim-screenshot-${Date.now()}.png`);
                await page.screenshot({ path: screenshotPath });
                return {
                    status: 'success',
                    stateChanged: false,
                    observation: await session.inspect(),
                    screenshotPath,
                    durationMs: Date.now() - startTime
                };
            default:
                throw new Error(`Unsupported browser action: ${action}`);
        }
    } catch (e: any) {
        stateChanged = false;
        errorMsg = e.message;
    }

    return {
        status: errorMsg ? 'failed' : 'success',
        stateChanged,
        observation: await session.inspect(),
        error: errorMsg,
        durationMs: Date.now() - startTime
    };
}

export class BrowserSession {
    public browser: Browser | null = null;
    public context: BrowserContext | null = null;
    public page: Page | null = null;

    async launch(headless: boolean = true) {
        this.browser = await chromium.launch({ headless });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
    }

    async inspect() {
        if (!this.browser || !this.page) {
            throw new Error("Browser session not initialized");
        }

        const url = this.page.url();
        const title = await this.page.title();

        // Inject script to extract accessibility tree and mark elements with data-whim-ref
        const elements = await this.page.evaluate(() => {
            const interactableSelectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';
            const els = document.querySelectorAll(interactableSelectors);
            const results: any[] = [];

            els.forEach((el, index) => {
                const htmlEl = el as HTMLElement;
                // Only consider visible elements
                if (htmlEl.offsetWidth === 0 || htmlEl.offsetHeight === 0) return;
                const style = window.getComputedStyle(htmlEl);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

                const ref = `e${index}`;
                htmlEl.setAttribute('data-whim-ref', ref);

                let name = htmlEl.getAttribute('aria-label') || htmlEl.innerText || htmlEl.getAttribute('placeholder') || htmlEl.getAttribute('value') || '';
                name = name.trim().substring(0, 50);

                const role = htmlEl.getAttribute('role') || htmlEl.tagName.toLowerCase();

                let value = undefined;
                if (htmlEl instanceof HTMLInputElement || htmlEl instanceof HTMLTextAreaElement || htmlEl instanceof HTMLSelectElement) {
                    value = htmlEl.value;
                }

                const enabled = !htmlEl.hasAttribute('disabled');

                results.push({
                    ref,
                    role,
                    name,
                    value,
                    enabled
                });
            });

            return results;
        });

        return {
            url,
            title,
            tabs: this.browser.contexts().flatMap(c => c.pages()).map(p => ({
                title: '',
                url: p.url()
            })),
            elements
        };
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.context = null;
        }
    }
}

const PORT = process.env.SIDECAR_PORT || 8765;
server.listen(PORT, () => {
    console.log(`Node execution sidecar running on port ${PORT}`);
});
