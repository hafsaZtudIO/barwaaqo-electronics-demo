"use client";

import { useEffect, useRef, useState } from "react";
import { ProductPhoto } from "./product-photo";

export function ProductPhotoField({ imageUrl = "" }) {
    const input = useRef(null);
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState("");
    const [url, setUrl] = useState(imageUrl);
    const [error, setError] = useState("");

    useEffect(() => () => {
        if (preview) URL.revokeObjectURL(preview);
    }, [preview]);

    function selectFile(event) {
        const selected = event.target.files?.[0];
        setError("");
        if (selected && (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || selected.size > 5 * 1024 * 1024)) {
            event.target.value = "";
            setFile(null);
            setPreview("");
            setError("Choose a JPG, PNG, or WebP photo up to 5 MB.");
            return;
        }
        setFile(selected ?? null);
        setPreview(selected ? URL.createObjectURL(selected) : "");
    }

    return <div className="field field-wide product-photo-field">
        <span>Product photo</span>
        <label className="field">
            <span>Browse files</span>
            <input ref={input} type="file" name="image_file" accept="image/jpeg,image/png,image/webp" onChange={selectFile}/>
        </label>
        <small className="muted">Choose a JPG, PNG, or WebP photo from your device (up to 5 MB).</small>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {(file || url) && <ProductPhoto product={{ name: "Product photo preview", image_url: preview || url }} variant="detail" decorative={false}/>}
        {file && <button type="button" className="button button-secondary button-small" onClick={() => {
            input.current.value = "";
            setFile(null);
            setPreview("");
        }}>Remove selected file</button>}
        <label className="field">
            <span>Or paste a photo URL (HTTPS)</span>
            <input name="image_url" type="url" value={url} maxLength={1500} disabled={Boolean(file)} onChange={event => setUrl(event.target.value)}/>
        </label>
    </div>;
}
