# Resource + Metaobject Import/Export Feature

Supports CSV exports for Shopify resources and CSV-driven metaobject imports with command-based behavior.

## Tool Overview

This tool supports bulk data movement and controlled metaobject updates:

- Export resource handles (products, collections, articles, pages) to CSV.
- Export metaobjects with optional field values and optional command column.
- Import metaobjects from CSV with command-driven behavior per row.
- Return import summaries and error logs to speed up retries.

```text
import-export-metaobjects/
├── index.ts                          # Public API exports for route usage
├── constants.ts                      # Export options, import intent, allowed commands
├── types.ts                          # Export/import payload and summary types
├── hooks.ts                          # Export workflow hooks for UI state
├── utils.ts                          # CSV filename and row validation helpers
├── components/
│   ├── HandleExportSection.tsx       # Product/collection/article/page export controls
│   ├── MetaobjectExportSection.tsx   # Metaobject export options + trigger UI
│   ├── MetaobjectImportSection.tsx   # CSV upload and import execution UI
│   └── index.ts                      # Component barrel exports
└── server/
    ├── loaders.ts                    # Export CSV response loader helpers
    ├── queries.ts                    # Data fetchers for export source records
    ├── mutations.ts                  # Command-driven metaobject import operations
    └── index.ts                      # Server export barrel
```

## Used By

- Route: `app/routes/app.resource-import-export.tsx`
- Download endpoint: `app/routes/app.metaobject-export-download.tsx`
- Core import action: `processMetaobjectImport`
