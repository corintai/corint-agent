# Knowledge Directory

This directory contains knowledge base assets for CORINT Agent.

## Structure

- `rdl/` - Symlink to RDL DSL documentation (`../../corint-decision/docs/dsl`)
  - Contains RDL syntax documentation, examples, and best practices
  - Used by the `rdl-generator` sub agent for rule generation

## Usage

The RDL knowledge base is automatically loaded by the agent when generating or optimizing rules:

```typescript
// Access RDL documentation
const ruleSyntax = await readFile('knowledge/rdl/rule.md')
const pipelineSyntax = await readFile('knowledge/rdl/pipeline.md')
const examples = await glob('knowledge/rdl/examples/**/*.yaml')
```

## Notes

- The `rdl/` directory is a symbolic link, not a physical copy
- Changes to RDL documentation in `corint-decision/docs/dsl` are immediately reflected here
- Do not modify files through this symlink; edit the source files in `corint-decision/docs/dsl` instead
