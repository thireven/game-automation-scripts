// The page style and theme, shared by the settings page and the Quick Bar.
//
// Two styles: Accessible (the default: flat, larger, high contrast) and Felt.
// Accessible also has a size (XS to L, Small by default); the settings page uses
// it, the Quick Bar does not, since the host fixes the strip's height.
// Each stylesheet that belongs to one is tagged `data-style` in the HTML; the
// one not in use gets `media="not all"`, so it stays loaded but applies nothing.
// The settings page owns the toggle and tells the strip with
// `PageMessage.Style`; both read the choice from localStorage.

/** One stored value, or null when storage is missing or refuses. */
function pageStoreGet(key: StorageKey): string | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch (e) {
        return null;
    }
}

function pageStoreSet(key: StorageKey, value: string): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, value);
        }
    } catch (e) {
        // Not remembered; the page still switches.
    }
}

function pageStoreRemove(key: StorageKey): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(key);
        }
    } catch (e) {
        // Nothing to undo.
    }
}

/** The Accessible style's size: Small unless another was chosen. */
function pageSize(): PageSize {
    var stored = pageStoreGet(StorageKey.Size);
    return stored === PageSize.ExtraSmall || stored === PageSize.Medium || stored === PageSize.Large
        ? stored : PageSize.Small;
}

/** Sets `data-size` on the root; a11y.css reads it. */
function applyPageSize(size: PageSize): void {
    document.documentElement.setAttribute('data-size', size);
}

/** The style in use: Accessible unless Felt was chosen. */
function pageStyle(): PageStyle {
    return pageStoreGet(StorageKey.Style) === PageStyle.Felt ? PageStyle.Felt : PageStyle.Accessible;
}

/** Turns on `style`'s sheets and off the other's, and marks the root for CSS. */
function applyPageStyle(style: PageStyle): void {
    document.documentElement.setAttribute('data-style', style);
    var sheets = document.querySelectorAll('style[data-style], link[data-style]');
    for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].getAttribute('data-style') === style) {
            sheets[i].removeAttribute('media');
        } else {
            sheets[i].setAttribute('media', 'not all');
        }
    }
}

/** What the device asks for. Dark, GAP's default, when it has no opinion. */
function systemTheme(): string {
    if (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
    }
    return 'dark';
}

/** The stored theme, or null while the page is still following the device. */
function storedTheme(): string | null {
    var stored = pageStoreGet(StorageKey.Theme);
    return stored === 'dark' || stored === 'light' ? stored : null;
}

/** Calls `onChange` when the device switches light/dark. */
function onSystemThemeChange(onChange: () => void): void {
    if (typeof window.matchMedia !== 'function') {
        return;
    }
    var query: any = window.matchMedia('(prefers-color-scheme: dark)');
    if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', onChange);
    } else if (typeof query.addListener === 'function') {
        query.addListener(onChange);   // pre-2020 WebViews
    }
}
