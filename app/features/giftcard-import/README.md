# Gift Card Import Feature

Handles gift card listing, manual creation, and CSV-based bulk creation.

## Tool Overview

This tool helps merchants manage gift cards from one page:

- View existing gift cards in a table with key details.
- Create a single gift card manually.
- Import many gift cards from CSV with row-level validation feedback.

```text
giftcard-import/
├── index.ts                        # Public API exports for route usage
├── constants.ts                    # CSV header requirements and feature constants
├── types.ts                        # Gift card + CSV row TypeScript models
├── hooks.ts                        # Feature hooks (currently reserved/empty)
├── utils.ts                        # CSV row validation and parsing helpers
├── components/
│   ├── GiftCardsTableSection.tsx   # Displays existing gift cards
│   ├── AddGiftCardSection.tsx      # Form to create one gift card manually
│   ├── ImportGiftCardsSection.tsx  # CSV upload/import UI and results
│   └── index.ts                    # Component barrel exports
└── server/
    ├── loaders.ts                  # Fetches gift card data for page loader
    ├── mutations.ts                # Handles manual + bulk create actions
    └── index.ts                    # Server export barrel
```

## Used By

- Route: `app/routes/app.giftcard-import.tsx`
- Loader: `loadGiftCardImportData`
- Action: `handleGiftCardAction`
