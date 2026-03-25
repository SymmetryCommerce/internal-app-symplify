import { useState } from "react";

export default function SitemapViewer() {
  const [sitemapXml, setSitemapXml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetchSitemap = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("https://test-1111111111111111111111111111111111711111111111128302.myshopify.com/sitemap.xml"); // or full shop URL
      console.log(res);
      if (!res.ok) throw new Error("Failed to fetch sitemap");

      const xmlText = await res.text();
      setSitemapXml(xmlText);
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Sitemap Viewer</h2>
      <button
        onClick={handleFetchSitemap}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        Download Sitemap XML
      </button>

      {loading && <p>Loading...</p>}
      {error && <p className="text-red-500">⚠ {error}</p>}

      {sitemapXml && (
        <pre className="mt-4 p-2 bg-gray-100 border rounded overflow-x-auto">
          {sitemapXml}
        </pre>
      )}
    </div>
  );
}