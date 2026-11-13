function makeHashSafe(s: string): string {
    return s.replace(/[{}()^]/g, (c) => {
        return `%${c.charCodeAt(0).toString(16)}`;
    });
}

export function buildShareURL(saveState: string, baseURL: string): string {
    return `${baseURL}#${makeHashSafe(saveState)}`;
}
