# Image Migration Feature

Finds externally hosted images in content, uploads them to Shopify Files, and updates content references to Shopify CDN URLs.

## Tool Overview

This tool helps migrate content images into Shopify-managed hosting:

- Scan blogs, pages, and metaobjects for external image URLs.
- Import one image at a time for targeted fixes.
- Batch import all detected external images for pages or metaobject entries.
- Save updated content so references point to Shopify CDN URLs.

```text
image-migration/
├── index.ts                           # Public API exports for route usage
├── constants.ts                       # Image regex/constants and extension rules
├── types.ts                           # Blog/page/metaobject and image data types
├── hooks.ts                           # UI state and batch-import orchestration hooks
├── utils.ts                           # HTML image extraction and URL transformation helpers
├── components/
│   ├── BlogsSection.tsx               # Blog/article image migration UI
│   ├── PagesSection.tsx               # Page-level image migration UI
│   ├── MetaobjectsSection.tsx         # Metaobject image migration UI
│   ├── ArticleImageAltEditor.tsx      # Article editor for image replacements
│   ├── PageImageMigrationEditor.tsx   # Page editor for image replacements
│   ├── MetaobjectGroupView.tsx        # Metaobject group container
│   ├── MetaobjectEntryView.tsx        # Metaobject entry view
│   ├── MetaobjectFieldRow.tsx         # Metaobject field-level row actions
│   └── index.ts                       # Component barrel exports
└── server/
    ├── loaders.ts                     # Loads blogs/pages/metaobject data
    ├── mutations.ts                   # Single and batch image import mutations
    └── index.ts                       # Server export barrel
```

## Used By

- Route: `app/routes/app.image-migration.tsx`
- Loader: `loadImageMigrationData`
- Actions: `importArticleImage`, `importPageImage`, `importAllPageImages`, `importMetaobjectImage`, `importAllMetaobjectImages`, `importAllGroupImages`
