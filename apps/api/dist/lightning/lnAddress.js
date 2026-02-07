export function parseLnAddress(addr) {
    const trimmed = String(addr ?? '').trim();
    const m = /^([^@\s]+)@([^@\s]+)$/.exec(trimmed);
    if (!m)
        throw new Error(`Invalid LN address: ${addr}`);
    const username = m[1].toLowerCase();
    const domain = m[2].toLowerCase();
    if (!username || !domain)
        throw new Error(`Invalid LN address: ${addr}`);
    return { username, domain };
}
function assertHttpUrl(u) {
    let url;
    try {
        url = new URL(u);
    }
    catch {
        throw new Error(`Invalid URL: ${u}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`Unsupported URL protocol: ${url.protocol}`);
    }
    return url;
}
export async function fetchLnurlPayParams(lnAddress) {
    const { username, domain } = parseLnAddress(lnAddress);
    const wellKnown = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(username)}`;
    const res = await fetch(wellKnown, {
        headers: { accept: 'application/json' },
    });
    if (!res.ok) {
        throw new Error(`LNURLp fetch failed (${res.status}) for ${lnAddress}`);
    }
    const json = (await res.json());
    if (!json.callback || !json.tag) {
        throw new Error(`LNURLp invalid response for ${lnAddress}`);
    }
    if (json.tag !== 'payRequest') {
        throw new Error(`LNURLp tag not payRequest for ${lnAddress} (got ${json.tag})`);
    }
    if (typeof json.minSendable !== 'number' || typeof json.maxSendable !== 'number') {
        throw new Error(`LNURLp missing min/max for ${lnAddress}`);
    }
    // Validate callback is a URL; do not allow weird protocols.
    assertHttpUrl(json.callback);
    return json;
}
export async function getBolt11InvoiceForLnAddress(opts) {
    const params = await fetchLnurlPayParams(opts.lnAddress);
    if (opts.amountMsat < BigInt(params.minSendable) || opts.amountMsat > BigInt(params.maxSendable)) {
        throw new Error(`LNURLp amount out of range for ${opts.lnAddress}: ${opts.amountMsat}msat not in [${params.minSendable}, ${params.maxSendable}]`);
    }
    const cb = new URL(params.callback);
    cb.searchParams.set('amount', opts.amountMsat.toString());
    if (opts.comment && params.commentAllowed && opts.comment.length <= params.commentAllowed) {
        cb.searchParams.set('comment', opts.comment);
    }
    const res = await fetch(cb.toString(), {
        headers: { accept: 'application/json' },
    });
    if (!res.ok) {
        throw new Error(`LNURLp invoice fetch failed (${res.status}) for ${opts.lnAddress}`);
    }
    const json = (await res.json());
    const errMsg = json.error?.message ?? json.reason;
    if (errMsg)
        throw new Error(`LNURLp invoice error for ${opts.lnAddress}: ${errMsg}`);
    if (!json.pr)
        throw new Error(`LNURLp invoice missing pr for ${opts.lnAddress}`);
    return { bolt11: json.pr, callback: cb.toString() };
}
