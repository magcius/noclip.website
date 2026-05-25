
// Runtime era selector. Scene ids are bare; classic and renewal differ only in
// the entity manifest fetched at load time.

export type Era = "classic" | "renewal";

const URL_KEY = "era";

function readFromUrl(): Era {
    if (typeof window === "undefined") return "renewal";
    return new URLSearchParams(window.location.search).get(URL_KEY) === "classic" ? "classic" : "renewal";
}

let era: Era = readFromUrl();

export function currentEra(): Era {
    return era;
}

export function setEra(next: Era): void {
    if (next === era) return;
    era = next;
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    if (next === "renewal") u.searchParams.delete(URL_KEY);
    else u.searchParams.set(URL_KEY, next);
    window.history.replaceState(null, "", u.toString());
}
