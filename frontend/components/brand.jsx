import Image from "next/image";
export function Brand() {
    return <div className="brand">
    <Image src="/logo.png" alt="" width={43} height={43} priority/>
    <span><strong>Barwaaqo</strong><small>ELECTRONICS</small></span>
  </div>;
}
