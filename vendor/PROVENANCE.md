# FriendSDK provenance

- Repository: https://github.com/spokesz/friendsdk
- Release: v0.1.2
- Archive: `rarefriends-friendsdk-0.1.2.tgz`
- SHA256: `a6352e187916089b6829c5387fe87f386c5774004f181990e4e3c8ae641cfe83`

`package.json` points at `vendor/rarefriends-friendsdk-0.1.2.tgz` because the SDK is not published to
npm. `scripts/vendor-sdk.mjs` re-fetches this archive from the release, verifies it
against the release's own `friendsdk-v0.1.2-SHA256SUMS.txt`, and fails rather than writing a mismatch.

A plain `github:spokesz/friendsdk` dependency does not work: the repo does not
commit `dist/`, and `prepack` — the only script that builds it — does not run on a
git install. See the script header for the full explanation.
