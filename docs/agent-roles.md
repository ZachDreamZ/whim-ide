# Agent Roles Guide

## Overview

Whim IDE uses a sophisticated agent role system to enforce execution boundaries and provide specialized AI assistance for different development tasks. Each role represents a specific mode of operation with carefully controlled tool permissions and capabilities.

## Role Philosophy

Agent roles are **enforced execution boundaries**, not merely prompt labels. They provide:

- **Safety**: Read-only roles cannot accidentally modify code
- **Focus**: Specialized roles are optimized for specific tasks
- **Trust**: Users can grant appropriate permissions based on task requirements
- **Efficiency**: Role-aware routing selects optimal models and tools

## Available Roles

### Core Roles

#### Chat
**Purpose**: Conversational AI without tool access
**Tool Permissions**: None (read-only)
**Use Cases**: 
- General questions and discussions
- Conceptual explanations
- Brainstorming without code changes
**Aliases**: `chat`

#### Auto (Vibe/Orchestrator)
**Purpose**: Autonomous outcome-focused development
**Tool Permissions**: All tools except `tunnel`
**Use Cases**:
- End-to-end feature development
- Complex multi-step tasks
- When you want the agent to own the entire process
**Aliases**: `auto`, `orchestrator`, `vibe`
**Note**: The default "Vibe" mode that owns outcomes end-to-end

### Development Roles

#### Planner
**Purpose**: Strategic planning and architecture design
**Tool Permissions**: `read_file`, `list_directory`, `grep_files`, `plan`, `research`
**Use Cases**:
- System architecture design
- Task breakdown and planning
- Research-heavy investigation
- Creating implementation strategies
**Aliases**: `plan`, `planner`

#### Researcher
**Purpose**: Deep investigation and information gathering
**Tool Permissions**: `read_file`, `list_directory`, `grep_files`, `plan`, `research`
**Use Cases**:
- Codebase exploration
- Technology research
- Documentation investigation
- Best practices research
**Aliases**: `research`, `researcher`

#### Implementer (Build)
**Purpose**: Code implementation and feature development
**Tool Permissions**: All tools
**Use Cases**:
- Writing new features
- Implementing specifications
- Code generation and modification
**Aliases**: `build`, `implementer`

#### Refactorer (Architect)
**Purpose**: Code restructuring and architecture improvements
**Tool Permissions**: All tools
**Use Cases**:
- Code refactoring
- Architecture improvements
- Design pattern implementation
- Code cleanup and optimization
**Aliases**: `refactorer`, `architect`

### Quality Assurance Roles

#### Reviewer
**Purpose**: Code review and analysis
**Tool Permissions**: `read_file`, `list_directory`, `grep_files`, `plan`, `research`, `github`
**Use Cases**:
- Pull request reviews
- Code quality analysis
- Style and pattern review
- GitHub integration
**Aliases**: `review`, `reviewer`

#### Tester (Verify)
**Purpose**: Testing and validation
**Tool Permissions**: `read_file`, `list_directory`, `grep_files`, `plan`, `research`, `verify`
**Use Cases**:
- Test execution and analysis
- Validation of changes
- Quality assurance
- Test plan creation
**Aliases**: `verify`, `tester`

#### SecurityReviewer
**Purpose**: Security-focused code review
**Tool Permissions**: `read_file`, `list_directory`, `grep_files`, `plan`, `research`
**Use Cases**:
- Security vulnerability analysis
- Security best practices review
- Threat modeling
- Security-focused investigation
**Aliases**: `security`, `securityreviewer`

#### Debugger
**Purpose**: Debugging and troubleshooting
**Tool Permissions**: All tools + `computer_action` for UI testing
**Use Cases**:
- Bug investigation and fixing
- Performance debugging
- UI testing and automation
- Interactive debugging
**Aliases**: `debug`, `debugger`

#### AccessibilityExpert
**Purpose**: Accessibility auditing and improvement
**Tool Permissions**: All tools + `computer_action` for UI testing
**Use Cases**:
- Accessibility compliance checking
- Screen reader testing
- Keyboard navigation testing
- WCAG compliance review
**Aliases**: `accessibilityexpert`, `a11y`

### Specialized Roles

#### Designer
**Purpose**: UI/UX design and implementation
**Tool Permissions**: All tools
**Use Cases**:
- UI component design
- User experience design
- Design system implementation
- Visual design tasks
**Aliases**: `design`, `designer`

#### ReleaseAgent (Ship)
**Purpose**: Release management and deployment
**Tool Permissions**: All tools
**Use Cases**:
- Release preparation
- Deployment coordination
- Version management
- Release notes generation
**Aliases**: `ship`, `releaseagent`

#### Janitor
**Purpose**: Maintenance and cleanup tasks
**Tool Permissions**: `read_file`, `list_directory`, `grep_files`, `plan`, `edit_file`, `verify`
**Use Cases**:
- Code cleanup
- Dependency updates
- Maintenance tasks
- File organization
**Note**: Limited to 3 file edits per run, never auto-merges
**Aliases**: `janitor`

### Creative & Game Development Roles

#### GameDesigner
**Purpose**: Game design and mechanics
**Tool Permissions**: `read_file`, `list_directory`, `grep_files`, `plan`, `research`
**Use Cases**:
- Game mechanics design
- Level design
- Game system architecture
- Gameplay balancing
**Aliases**: `gamedesigner`, `game_designer`

#### TechArtist
**Purpose**: Technical art and shader development
**Tool Permissions**: All tools
**Use Cases**:
- Shader development
- Technical art implementation
- Graphics programming
- Asset pipeline work
**Aliases**: `techartist`, `tech_artist`

#### Playtester
**Purpose**: Game testing and quality assurance
**Tool Permissions**: `read_file`, `list_directory`, `grep_files`, `plan`, `research`, `verify`
**Use Cases**:
- Gameplay testing
- Game QA
- User experience testing
- Bug reporting for games
**Aliases**: `playtester`

#### AssetGenerator
**Purpose**: Asset creation and generation
**Tool Permissions**: All tools
**Use Cases**:
- 3D model generation
- Texture creation
- Asset pipeline automation
- Resource generation
**Aliases**: `assetgenerator`, `asset_generator`

### Data & Localization Roles

#### DataScientist
**Purpose**: Data analysis and machine learning
**Tool Permissions**: All tools
**Use Cases**:
- Data analysis
- Machine learning implementation
- Statistical analysis
- Data pipeline development
**Aliases**: `datascientist`, `data_scientist`

#### Localizer
**Purpose**: Internationalization and localization
**Tool Permissions**: All tools
**Use Cases**:
- Translation management
- Localization implementation
- Cultural adaptation
- Internationalization (i18n) work
**Aliases**: `localizer`

## Tool Permission Matrix

| Role | Read | Write | Edit | List | Grep | Plan | Research | Verify | Run | GitHub | Computer |
|------|------|-------|------|------|------|------|----------|--------|-----|--------|----------|
| Chat | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Auto | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Planner | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Researcher | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Implementer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reviewer | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Tester | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| SecurityReviewer | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Designer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Debugger | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ReleaseAgent | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Janitor | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| GameDesigner | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| TechArtist | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Playtester | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| AssetGenerator | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Refactorer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| DataScientist | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AccessibilityExpert | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Localizer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Usage Guidelines

### When to Use Each Role

#### For New Development
1. **Start with Planner**: Design the architecture and approach
2. **Use Implementer**: Write the actual code
3. **Switch to Tester**: Validate the implementation
4. **Use Reviewer**: Get code review feedback

#### For Bug Fixing
1. **Use Debugger**: Investigate and identify the issue
2. **Switch to Implementer**: Apply the fix
3. **Use Tester**: Verify the fix works
4. **Use Janitor**: Clean up any related issues

#### For Security Reviews
1. **Use SecurityReviewer**: Perform security analysis
2. **Switch to Implementer**: Apply security fixes
3. **Use Tester**: Validate security improvements

#### For Game Development
1. **Use GameDesigner**: Design game mechanics
2. **Switch to Implementer**: Implement game logic
3. **Use Playtester**: Test gameplay
4. **Use TechArtist**: Implement visual effects

#### For Release Management
1. **Use ReleaseAgent**: Coordinate release process
2. **Switch to Tester**: Validate release candidates
3. **Use Reviewer**: Final review before release

### Role Selection Best Practices

1. **Start with read-only roles** when investigating or planning
2. **Grant write permissions** only when ready to make changes
3. **Use specialized roles** for their specific domains
4. **Leverage Auto mode** for end-to-end autonomous tasks
5. **Use Chat mode** for discussions without side effects

### Safety Considerations

- **Read-only roles** (Chat, Planner, Researcher) cannot accidentally modify code
- **Janitor role** is intentionally limited to 3 file edits per run
- **Security-focused roles** have restricted permissions to prevent security risks
- **UI testing roles** (Debugger, AccessibilityExpert) include computer_action for UI automation

## Custom Role Creation

### Understanding Role Permissions

Roles are defined by their `permits_tool` method in the Rust backend. To understand custom role creation:

1. **Tool Access**: Each role explicitly permits or denies specific tools
2. **Safety Boundaries**: Read-only roles prevent accidental modifications
3. **Special Capabilities**: Some roles have unique permissions (e.g., computer_action)
4. **Domain Specialization**: Roles are optimized for specific task domains

### Creating Custom Roles

Currently, custom roles are defined in the Rust codebase (`src-tauri/src/agent/provider.rs`). To add a custom role:

1. **Add role to AgentRole enum**:
```rust
pub enum AgentRole {
    // ... existing roles
    CustomRole, // Add your custom role
}
```

2. **Add parsing support**:
```rust
pub(crate) fn parse(value: Option<&str>) -> Result<Self, String> {
    match value.unwrap_or("auto").trim().to_ascii_lowercase().as_str() {
        // ... existing mappings
        "custom" | "customrole" => Ok(Self::CustomRole),
        // ... rest of mappings
    }
}
```

3. **Add string representation**:
```rust
pub(crate) fn as_str(self) -> &'static str {
    match self {
        // ... existing mappings
        Self::CustomRole => "customrole",
        // ... rest of mappings
    }
}
```

4. **Define tool permissions**:
```rust
pub(crate) fn permits_tool(self, name: &str) -> bool {
    match self {
        // ... existing permissions
        Self::CustomRole => matches!(
            name,
            "read_file" | "list_directory" | "grep_files" | "plan"
            // Add tools your role should access
        ),
        // ... rest of permissions
    }
}
```

### Future Custom Role Support

Planned enhancements include:
- **YAML/JSON role definitions** for user-defined roles
- **Role composition** (combining permissions from multiple roles)
- **Dynamic role loading** via plugin system
- **Role templates** for common patterns

## Integration with Other Systems

### Capabilities System
Agent roles work in conjunction with the capabilities system:
- Capabilities define available features (e.g., computer-use, workspace)
- Roles define tool access boundaries
- Both systems enforce safety and provide granular control

### Provider Routing
Role-aware provider routing optimizes model selection:
- Read-only roles default to cost-effective models
- Implementation roles use capable coding models
- Specialized roles may use domain-specific models

### Harness Profiles
Project harness profiles can further restrict tool access:
- Roles provide baseline permissions
- Profiles add project-specific restrictions
- Both systems enforce safety boundaries

## Examples

### Example 1: Feature Development Workflow
```bash
# 1. Plan the feature
whim --role planner "Design a user authentication system"

# 2. Implement the feature
whim --role implementer "Implement the authentication system using the plan"

# 3. Test the implementation
whim --role tester "Test the authentication system"

# 4. Review the changes
whim --role reviewer "Review the authentication implementation"
```

### Example 2: Bug Investigation
```bash
# 1. Debug the issue
whim --role debugger "Investigate why the login form isn't submitting"

# 2. Fix the bug
whim --role implementer "Fix the form submission bug"

# 3. Verify the fix
whim --role tester "Test the login form after the fix"
```

### Example 3: Security Review
```bash
# 1. Security analysis
whim --role securityreviewer "Review the payment processing code for security vulnerabilities"

# 2. Apply security fixes
whim --role implementer "Implement the security recommendations"

# 3. Validate security improvements
whim --role tester "Test the security improvements"
```

### Example 4: Game Development
```bash
# 1. Design game mechanics
whim --role gamedesigner "Design a character progression system"

# 2. Implement game logic
whim --role implementer "Implement the character progression system"

# 3. Test gameplay
whim --role playtester "Test the character progression system"

# 4. Add visual effects
whim --role techartist "Implement level-up visual effects"
```

## Troubleshooting

### Role Permission Issues
If a role cannot access a tool:
1. Check the tool permission matrix above
2. Verify you're using the correct role for the task
3. Consider switching to a role with broader permissions

### Role Selection Confusion
If unsure which role to use:
1. Start with read-only roles (Planner, Researcher) for investigation
2. Use Auto mode for end-to-end tasks
3. Use specialized roles for domain-specific tasks

### Custom Role Limitations
Currently, custom roles require Rust code changes. Future updates will support:
- User-defined role configurations
- Dynamic role loading
- Role composition and inheritance

## Best Practices

1. **Principle of Least Privilege**: Use the most restrictive role that can accomplish the task
2. **Role Progression**: Start with read-only roles, progressively grant more permissions
3. **Specialization**: Leverage specialized roles for domain-specific tasks
4. **Validation**: Always use Tester role after implementation changes
5. **Review**: Use Reviewer role for code quality and security checks

## Conclusion

The agent role system provides a powerful framework for safe, focused AI assistance. By understanding each role's capabilities and using them appropriately, you can leverage Whim's AI capabilities while maintaining proper safety boundaries and development best practices.