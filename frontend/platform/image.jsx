export function assetUrl(source) {
    return typeof source === "string" && source.startsWith("/")
        ? new URL("public" + source, window.location.href).href : source;
}

export default function Image({ src, alt, priority, unoptimized: _unoptimized, fill: _fill, ...props }) {
    return <img {...props} src={assetUrl(src)} alt={alt} loading={priority ? "eager" : props.loading}/>;
}
