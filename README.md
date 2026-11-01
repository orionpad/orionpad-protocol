# ORIONPAD

A launch desk and live market board for Robinhood Chain.

[![Live site](https://img.shields.io/badge/live-orionpad.app-fe813c)](https://orionpad.app)

| | |
|---|---|
| Network | Robinhood Chain (chain ID 4663, `0x1237`) |
| Contract address | `pending` |
| Site | https://orionpad.app |

## Overview

ORIONPAD pairs a token launch desk with a public board of what is moving on Robinhood Chain. The first row of the board is always reserved for the ORIONPAD token: a placeholder until its contract address is stated, live pool data afterwards.

## Features

- Live board of the busiest Robinhood Chain pools, refreshed every minute and paused while the tab is hidden
- Pinned own-token row that switches from placeholder to real pool data once the contract address is set
- Scrolling ticker fed by the same data as the board
- Click-to-copy contract slot at the top of every page
- Register-driven links: nothing is linked until it is stated
- Respects reduced-motion preferences

## Links

- Site: https://orionpad.app
- X: pending
- GitHub: pending

## Development

```bash
npm run build   # src/ -> dist/
npm run gates   # build checks, both contract-address branches
```

`dist/` is the deploy folder. Facts such as the contract address and social links live in `src/register.json`; set a record's `state` to `stated` and give it its `value` or `url`, then rebuild.

## License

MIT
