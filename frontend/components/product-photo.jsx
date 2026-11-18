"use client";

import Image from "next/image";
import { Package } from "lucide-react";
import { useState } from "react";

const demoPhotos = {
    "DEMO-WALL-20": "wall-charger",
    "DEMO-MONITOR": "monitor",
    "DEMO-USB-C": "usb-c-cable",
    "DEMO-HEADSET": "headphones",
    "DEMO-MOUSE": "mouse",
};
const iphonePhoto = "https://www.apple.com/newsroom/images/2023/09/apple-debuts-iphone-15-and-iphone-15-plus/article/Apple-iPhone-15-lineup-color-lineup-230912_big.jpg.large.jpg";

function ProductImage({ source, size, alt }) {
    const [failed, setFailed] = useState(false);
    return failed ? <Package size={size > 50 ? 30 : 17} aria-hidden="true"/> :
        <Image src={source} alt={alt} width={size} height={size} unoptimized referrerPolicy="no-referrer"
          onError={() => setFailed(true)}/>;
}

export function ProductPhoto({ product, variant = "thumbnail", decorative = true }) {
    const demo = Object.hasOwn(demoPhotos, product.sku) ? demoPhotos[product.sku] : null;
    const reference = product.sku === "2" && product.name === "iPhone 15" ? iphonePhoto : null;
    const source = product.image_url || (demo && `/product-photos/${demo}.webp`) || reference;
    const size = variant === "thumbnail" ? 44 : 180;
    return <span className={`product-photo product-photo-${variant}`} aria-hidden={decorative || undefined}>
      {source ? <ProductImage key={source} source={source} size={size} alt={decorative ? "" : product.name}/> :
        <Package size={size > 50 ? 30 : 17} aria-hidden="true"/>}
    </span>;
}
