# @prmflow/openflow

Deprecated compatibility wrapper for `@travisliu/open-dynamic-workflow`.

The package name has moved:

```bash
npm install @travisliu/open-dynamic-workflow
npx @travisliu/open-dynamic-workflow --help
```

This package keeps the old CLI entry working temporarily:

```bash
npx @prmflow/openflow --help
```

When the old CLI is used, it prints a deprecation warning and forwards the command to `@travisliu/open-dynamic-workflow`.

Library imports are also re-exported for compatibility:

```ts
import { defineTool } from "@prmflow/openflow";
```

Please migrate imports to:

```ts
import { defineTool } from "@travisliu/open-dynamic-workflow";
```
