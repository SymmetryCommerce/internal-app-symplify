// Components
export { 
    ArticleImageAltEditor,
    MetaobjectEntryView,
    MetaobjectGroupView,
    MetaobjectFieldRow,
    PageImageMigrationEditor,
    BlogsSection,
    MetaobjectsSection,
    PagesSection
 } from "./components";

// Hooks
export {
    useImageMigrationUI,
    usePageBatchImport
} from "./hooks";

// Types
export type {
    ArticleNode,
    ArticleEdge,
    ArticlesConnection,
    BlogNode,
    BlogEdge,
    PageNode,
    PageEdge,
    ImgInfo,
    MetaobjectField,
    MetaobjectEntry,
    MetaobjectGroup,
    ArticleImageAltEditorProps,
} from "./types";

// Constants
export {
    IMG_TAG_REGEX,
    IMAGE_EXTENSIONS
} from "./constants";

// Utils (feature-specific)
export { 
    extractImagesFromHtml,
    isShopifyCdn,
    countMissingAlt,
    updateImageAlt,
    replaceImgSrcByIndex,
    isExternalImageUrl
} from "./utils";

// Server (mutations, queries, loaders)
export {
    loadImageMigrationData,
    uploadExternalImageToShopifyCdn,
    importArticleImage,
    importPageImage,
    importAllPageImages,
    importMetaobjectImage,
    importAllMetaobjectImages,
    importAllGroupImages,
    updateArticleBody,
    updatePageBody,
} from "./server";
