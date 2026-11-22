export function assetUrl(source) {
    if (typeof source === "string" && source.startsWith("https://barwaaqo-demo.invalid/photos/")) {
        return localStorage.getItem("barwaaqo-demo-photo-" + source.slice("https://barwaaqo-demo.invalid/photos/".length)) || "";
    }
    return typeof source === "string" && source.startsWith("/")
        ? new URL("public" + source, window.location.href).href : source;
}

export default function Image({ src, alt, priority, unoptimized: _unoptimized, fill: _fill, ...props }) {
    return <img {...props} src={assetUrl(src)} alt={alt} loading={priority ? "eager" : props.loading}/>;
}
