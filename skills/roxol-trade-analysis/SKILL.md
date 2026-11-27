---
name: roxol-trade-analysis
description: Assess Roblox Limiteds trades with the Roxol MCP connector. Use when a user shares a Limiteds trade screenshot, describes an exchange, or asks whether a trade was a win, fair, or a loss.
---

# Roxol trade analysis

## Establish the exchange

- Read the screenshot or description for the two baskets, exact items, quantities, and Robux on each side. Orient `give` and `receive` from the user's perspective using visible offer labels or their wording. Preserve the status, date and time precision, trade ID, and copy identifiers when visible. Distinguish a copy's UAID or collectible instance UUID from its asset ID and serial.
- Resolve consequential ambiguity before a verdict. A cropped Robux field is unknown. Use zero when the complete record shows no Robux or the user confirms none. If the direction, an item, or the Robux amount could change the verdict, ask one focused question or give conditional findings. Keep screenshot totals separate from newly retrieved metrics.
- Assess the exchange that was shown. For a dated completed trade, prefer evidence available at the trade date and prior comparables. Label current metrics as a separate snapshot and later observations as hindsight or corroboration. For an offer or an undated exchange, state which market date the assessment uses.

## Retrieve and interpret evidence

- Use the connected Roxol MCP tools by their advertised names. Start with one `get_trade_context` call for both baskets. Supply only known gross Robux and enable ownership history when copy identifiers are available. For unknown or net-only Robux, treat any tool default as provisional and keep item-only totals until the basis can be established. Read [Connector fields and follow-up tools](references/connector.md) when interpreting compact fields, handling partial results, or choosing a follow-up.
- Compare quantity-adjusted received minus given RAP and Value separately, accounting for the trade fee. Identify assigned Value, RAP and other fallbacks. Treat gaps as unknown and label estimates. Evaluate whether the nominal difference is meaningful given demand, supply, recent sale prices and volume, availability of buyers, recent Value changes and any projection flags. Best listing price is an ask. Sparse or unusual sales warrant caution when using RAP.
- Use [Comparable transactions](references/comparables.md) when using trade proofs, transfer observations, or historical overpays. Rank comparable exchanges by basket match, direction, market conditions and evidence quality. Reconstruct dated valuations only where coverage supports them. Group probable duplicates without discarding uncertain records, and exclude the evaluated exchange from its own benchmark.
- Assess tracked copy history separately from the market verdict. Note corroborated changes, timing, coverage gaps and any identity mismatch. Rapid transfers or hidden entries may warrant further review. Ownership history alone cannot establish theft, poisoning, or safety.
- Make targeted follow-ups only when they can resolve a material uncertainty. Stop when the evidence supports the conclusion or further available results are unlikely to change it. If the connector is unavailable, explain what can be established from the record and identify the missing evidence.

## Give the verdict

Lead with **W**, **Fair**, or **L** from the stated perspective and **high**, **moderate**, or **low** confidence. A win or loss reflects a meaningful advantage or disadvantage after considering the relevant market evidence. Fair means the exchange is supported as broadly in line with comparable terms. If material evidence is missing, label any defensible lean as provisional or say the verdict is undetermined and identify what would resolve it.

Show both baskets, the signed nominal RAP and Value differences with their date and basis, and the strongest reasons for the verdict. Include observed overpay or a comparable range only when the evidence supports it, with the sample size and relevant dates. Cite specific posts or provider links returned by Roxol. State any limitation that materially changes the interpretation. Confidence should reflect the certainty of the recorded terms, price coverage, and the relevance, independence and consistency of available evidence. Keep the explanation concise.
