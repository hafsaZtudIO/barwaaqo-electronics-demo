import { publicUrl, router } from "./navigation";

export default function Link({ href, children, onClick, prefetch: _prefetch, replace, scroll: _scroll, ...props }) {
    return <a {...props} href={publicUrl(href)} onClick={event => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === "_blank")
            return;
        event.preventDefault();
        if (replace) router.replace(href);
        else router.push(href);
    }}>{children}</a>;
}
