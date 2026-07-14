import { WebSocketServer } from 'ws';
import * as http from 'http';

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Tauri backend connected to Sidecar.');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log('Received command:', data.command);

            if (data.command === 'run_openai_agent') {
                // Initialize @openai/agents
                ws.send(JSON.stringify({ status: 'running', agent: 'openai', task: data.task }));
                
                // Simulate execution
                setTimeout(() => {
                    ws.send(JSON.stringify({ status: 'complete', result: 'OpenAI Agent completed the task: ' + data.task }));
                }, 2000);
            } 
            else if (data.command === 'run_claude_agent') {
                // Initialize @anthropic-ai/sdk agent
                ws.send(JSON.stringify({ status: 'running', agent: 'claude', task: data.task }));
                
                // Simulate execution
                setTimeout(() => {
                    ws.send(JSON.stringify({ status: 'complete', result: 'Claude Agent completed the task: ' + data.task }));
                }, 2000);
            }
            else {
                ws.send(JSON.stringify({ error: 'Unknown command' }));
            }
        } catch (e: any) {
            ws.send(JSON.stringify({ error: e.message }));
        }
    });
});

const PORT = process.env.SIDECAR_PORT || 8765;
server.listen(PORT, () => {
    console.log(`Node execution sidecar running on port ${PORT}`);
});
