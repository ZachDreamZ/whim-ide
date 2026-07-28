# Vibe Coding Architecture Specification

## Vision

Whim IDE is the premier autonomous vibe coding harness - designed for engineers who think in outcomes, not implementation details. The system handles the entire development lifecycle autonomously: from intent to deployment, with minimal manual intervention.

## Core Principles

1. **Intent-Driven Development**: Users express what they want in natural language; the system figures out how to build it
2. **Autonomous Execution**: No manual editing, no complex configuration, no editor deep-dives required
3. **Transparent Reasoning**: The system explains what it's doing and why, building trust through visibility
4. **Safe Automation**: All changes are reversible, verified, and contained within proper guardrails
5. **Progressive Enhancement**: Starts simple, learns preferences, and becomes more capable over time

## System Architecture

### The Autonomous Vibe Loop

```
User Intent → Understanding → Planning → Execution → Verification → Deployment → Learning
     ↓              ↓            ↓           ↓            ↓            ↓          ↓
  Natural NLP   Context      Agent      Native       Tests      Ship     Preferences
  Processing   Index       Runtime    Tools        Checks     Adapters  Evolution
```

### Component Responsibilities

#### 1. Intent Understanding Layer
- **Natural Language Processor**: Parses user intent into structured requirements
- **Context Index**: Maintains living knowledge of project architecture, patterns, and conventions
- **Intent Brief**: Durable, editable specification that evolves with the project
- **Vibe Pipeline**: Manages the flow from casual request to concrete technical specification

#### 2. Planning & Orchestration Layer
- **LangGraph Workflow**: Coordinates the autonomous execution pipeline
- **Rust Ledger (DurableJobStore)**: Single source of truth for all task state and history
- **Agent Mode Router**: Selects appropriate specialist agents based on task requirements
- **Capability Manager**: Dynamically loads tools and permissions based on task context

#### 3. Agent Runtime Layer
- **Native Agent Harness**: Provider-agnostic agent execution with tool calling
- **Tool Registry**: Extensible tool system with built-in safety guards
- **Multi-Agent Coordination**: Fans out independent research tasks and synthesizes results
- **Loop Detection**: Prevents infinite loops and stuck states

#### 4. Execution & Verification Layer
- **Workspace Operations**: Scoped file operations with automatic checkpointing
- **Command Execution**: Safe command execution with output capture and error handling
- **Verification System**: Automatic discovery and execution of project tests
- **Preview System**: Live preview of changes with evidence capture

#### 5. Deployment Layer
- **Adapter System**: Pluggable deployment adapters for various platforms
- **Preflight Checks**: Validates deployment readiness before execution
- **Safe Rollback**: Automatic rollback mechanisms for failed deployments
- **Production Gates**: Explicit human confirmation for production deployments

#### 6. Learning & Adaptation Layer
- **Preference Engine**: Learns from user corrections and successful patterns
- **Memory System**: Durable storage of project knowledge and user preferences
- **Skill System**: Reusable workflows and patterns specific to project types
- **Feedback Integration**: Continuous improvement based on outcomes

## Agent Mode System

### Core Autonomous Modes

#### Vibe Mode (Default)
- **Purpose**: End-to-end autonomous development
- **Tools**: Full tool set (read, write, edit, verify, deploy)
- **Behavior**: Owns the outcome completely, makes decisions without asking
- **Use Case**: "Add user authentication to this app"

#### Planner Mode
- **Purpose**: Creates implementation plans without executing
- **Tools**: Read-only tools (read, search, plan)
- **Behavior**: Investigates and documents approach, stops before changes
- **Use Case**: "Plan how to add real-time notifications"

#### Researcher Mode
- **Purpose**: Independent investigation and synthesis
- **Tools**: Read-only + research delegation
- **Behavior**: Fans out parallel research tasks, combines findings
- **Use Case**: "Research the best state management approach"

#### Implementer Mode
- **Purpose**: Executes planned changes
- **Tools**: Write tools + verification
- **Behavior**: Implements from spec, verifies results
- **Use Case**: "Implement the authentication system we planned"

#### Verifier Mode
- **Purpose**: Tests and validates changes
- **Tools**: Verification tools only
- **Behavior**: Runs tests, captures evidence, reports findings
- **Use Case**: "Verify the authentication system works"

#### Release Mode
- **Purpose**: Prepares and executes deployments
- **Tools**: Deployment tools + preflight checks
- **Behavior**: Prepares release, runs checks, awaits production confirmation
- **Use Case**: "Deploy this to production"

### Specialist Modes (Domain-Specific)

#### Designer Mode
- **Purpose**: UI/UX improvements and frontend work
- **Tools**: Frontend-focused tools + design system integration
- **Behavior**: Focuses on visual and interaction improvements

#### Debugger Mode
- **Purpose**: Diagnoses and fixes issues
- **Tools**: Debugging tools + targeted testing
- **Behavior**: Systematic diagnosis with verification

#### Security Reviewer Mode
- **Purpose**: Security audits and vulnerability detection
- **Tools**: Security scanning tools + code analysis
- **Behavior**: Identifies security issues and recommends fixes

## Capability System

### Core Capabilities

#### Workspace Capability
- **Description**: Inspect and modify project files
- **Tools**: `read_file`, `list_directory`, `grep_files`, `plan`
- **Always Active**: Required for all modes
- **Safety**: Path scoping, traversal protection

#### Research Capability
- **Description**: Parallel independent investigations
- **Tools**: `research` (delegates to sub-agents)
- **Defer Loading**: Active in research/plan modes only
- **Safety**: Read-only, cancellable, bounded

#### Coding Capability
- **Description**: Implement changes with checkpoints
- **Tools**: `write_file`, `edit_file`, `delegate_task`, `checkpoint`, `rollback`
- **Defer Loading**: Active in non-read-only modes
- **Safety**: Automatic checkpoints, instant rollback

#### Verification Capability
- **Description**: Run project-discovered checks
- **Tools**: `run_command`, `verify`, `preview`
- **Defer Loading**: Active in build/verify modes
- **Safety**: Discovered commands only, output capture

#### Computer-Use Capability
- **Description**: Windows desktop automation
- **Tools**: `computer_action`
- **Opt-in**: Requires explicit user enable
- **Safety**: Accessibility-based, explicit verification

#### MCP Capability
- **Description**: External tool integration
- **Tools**: Dynamic MCP server tools
- **Always Available**: Loads from configuration
- **Safety**: Scoped permissions, isolated execution

#### GitHub Capability
- **Description**: GitHub operations
- **Tools**: `github` (PR management, comments)
- **Defer Loading**: Active in review/ship modes
- **Safety**: Local Git operations, explicit PR actions

## Provider & Model System

### Provider Strategy

#### OmniRoute (Recommended Default)
- **Purpose**: Intelligent model routing
- **Behavior**: Selects optimal model based on task type
- **Routes**: 
  - `auto/cheap` for read-only work (research, planning)
  - `auto/coding` for implementation work
- **Advantage**: Cost optimization with quality preservation

#### Direct Providers
- **Supported**: OpenAI, Anthropic, Google, DeepSeek, Qwen, Xiaomi
- **Use Case**: User preference or specific model requirements
- **Behavior**: Direct API calls with standard tool calling

#### Local Providers
- **Supported**: Ollama, LM Studio
- **Use Case**: Privacy-sensitive work or offline capability
- **Behavior**: Local inference with tool calling

#### Custom Endpoints
- **Supported**: OpenAI-compatible endpoints
- **Use Case**: Enterprise gateways or custom models
- **Behavior**: Standard tool calling over custom base URL

### Model Selection Logic

```typescript
function resolveModel(provider: string, task: TaskType, role: AgentRole): string {
  if (provider === "omniroute") {
    return isReadOnly(role) ? "auto/cheap" : "auto/coding";
  }
  if (provider === "local") {
    return firstAvailableLocalModel();
  }
  return userSelectedModel || providerDefault;
}
```

## Orchestration System

### LangGraph Workflow

The autonomous workflow is coordinated by LangGraph with Rust as the authoritative state manager:

```
prepare → persist → execute → finalize
   ↓         ↓         ↓         ↓
validation  ledger   agent    outcome
           storage  runtime  recording
```

#### Phase: Prepare
- Validates workspace and intent
- Resolves model selection
- Checks capability requirements
- Fails fast on invalid input

#### Phase: Persist
- Creates durable ledger record
- Assigns operation ID
- Sets budget and timeout
- Records initial state

#### Phase: Execute
- Runs native agent
- Streams progress events
- Captures tool execution
- Handles cancellation
- Enforces budget limits

#### Phase: Finalize
- Records final outcome
- Updates ledger state
- Triggers cleanup
- Reports completion

### Rust Ledger Authority

The `DurableJobStore` is the single source of truth:
- All job state persists here
- LangGraph coordinates but doesn't own state
- Recovery after restart uses ledger
- Audit trail comes from ledger
- No LangGraph state without ledger record

## Safety & Verification System

### Multi-Layer Safety

#### Input Validation
- Strict provider/model validation
- Path traversal protection
- Command injection prevention
- Size limits on all inputs

#### Execution Safety
- Scoped file operations
- Command allowlisting
- Timeout enforcement
- Resource budgeting

#### Verification Gates
- Automatic test discovery
- Pre-commit verification
- Deployment preflight
- Production confirmation

#### Recovery Mechanisms
- Automatic checkpoints
- Instant rollback
- Ledger-based recovery
- Clear error messages

### Verification Ladder

#### During Development
- Compile/build checks
- Unit tests
- Basic linting
- Quick smoke tests

#### Before Commit
- Full test suite
- Integration tests
- Security scanning
- Documentation updates

#### Before Deployment
- Full build verification
- Integration testing
- Security audit
- Performance checks
- Accessibility review

#### Production Deployment
- Explicit human confirmation
- Staged rollout
- Health monitoring
- Instant rollback capability

## Integration System

### MCP Integration
- **Discovery**: Configuration-based server discovery
- **Connection**: Automatic connection management
- **Tool Loading**: Dynamic tool registration
- **Execution**: Scoped tool execution with error handling
- **Synchronization**: Reload on configuration changes

### Deployment Integration
- **Adapters**: Pluggable deployment system
- **Preflight**: Readiness validation
- **Execution**: Safe command execution
- **Monitoring**: Health checks and status
- **Rollback**: Automatic failure recovery

### Computer-Use Integration
- **Opt-in**: Explicit user permission required
- **Inspection**: Accessibility-based UI discovery
- **Action**: Verified control invocation
- **Safety**: Bounded element cache, re-verification
- **Privacy**: Explicit capture only, no background monitoring

## User Experience Principles

### Simplicity First
- **Natural Language**: Express intent in plain language
- **Minimal Configuration**: Sensible defaults, optional customization
- **Progressive Disclosure**: Advanced options when needed
- **Clear Feedback**: Always explain what's happening and why

### Autonomous by Default
- **Decision Making**: System makes reasonable choices automatically
- **Error Recovery**: Automatic recovery from common failures
- **Optimization**: Continuous performance and cost optimization
- **Learning**: Adapts to user preferences over time

### Transparency & Control
- **Explainable AI**: Always show reasoning and plans
- **Reversible Actions**: Every change can be undone
- **Audit Trail**: Complete history of all actions
- **Human Override**: User can intervene at any point

## Performance & Scalability

### Performance Targets
- **Intent Processing**: < 2 seconds for understanding
- **Plan Generation**: < 10 seconds for complex tasks
- **Edit Execution**: < 5 seconds per file operation
- **Test Execution**: < 30 seconds for standard test suite
- **Deployment**: < 5 minutes for typical deployment

### Scalability Considerations
- **Large Codebases**: Efficient indexing and search
- **Long-Running Tasks**: Progress tracking and resumption
- **Parallel Operations**: Concurrent independent tasks
- **Resource Management**: Memory and CPU budgeting

## Security & Privacy

### Data Protection
- **Local-First**: Sensitive data stays local
- **Credential Security**: Windows Credential Manager integration
- **Network Security**: HTTPS-only for external calls
- **Secret Redaction**: Automatic secret detection and redaction

### Code Safety
- **Supply Chain**: Dependency verification
- **Injection Prevention**: Command and path validation
- **Access Control**: Scoped permissions and operations
- **Audit Logging**: Complete action recording

## Future Enhancements

### Near-Term
- Enhanced learning from user corrections
- Improved error recovery and suggestions
- Better multi-file coordination
- Expanded deployment adapter ecosystem

### Medium-Term
- Advanced planning with dependency analysis
- Collaborative features for teams
- Enhanced security scanning
- Performance optimization suggestions

### Long-Term
- Full project architecture understanding
- Predictive suggestions and recommendations
- Advanced workflow automation
- Enterprise features and compliance

## Success Metrics

### User Success
- **Task Completion Rate**: % of user intents successfully completed
- **Time to Outcome**: Average time from intent to working result
- **Error Recovery Rate**: % of errors automatically recovered
- **User Satisfaction**: Feedback on autonomy and correctness

### System Performance
- **Agent Success Rate**: % of agent tasks completed without intervention
- **Verification Pass Rate**: % of changes that pass verification
- **Deployment Success Rate**: % of successful deployments
- **Cost Efficiency**: Cost per successful outcome

### Technical Quality
- **Test Coverage**: % of codebase covered by tests
- **Security Score**: Vulnerability-free deployments
- **Performance**: Application performance metrics
- **Code Quality**: Maintainability and technical debt metrics

## Conclusion

This architecture positions Whim IDE as the premier autonomous vibe coding harness - a system that handles the complete development lifecycle from intent to deployment while maintaining safety, transparency, and user control. The focus on autonomous operation, intelligent defaults, and continuous learning makes it ideal for engineers who want to focus on outcomes rather than implementation details.
