# VoxSpell

VoxSpell is a Node.js 24+ and TypeScript monorepo managed with Yarn 4.

## Requirements

- Node.js 24 or newer
- Corepack

## Development

```bash
corepack yarn install
corepack yarn tiny build
corepack yarn tiny test
corepack yarn tiny dev
```

Project shortcuts are defined in `project.tiny` instead of npm scripts. Run
`corepack yarn tiny list` to see every available command. The `dev` shortcut
runs Rspack in watch mode and restarts the daemon with nodemon whenever the
bundle changes.
