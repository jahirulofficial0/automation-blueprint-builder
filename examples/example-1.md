# Example

## Input

Every time someone fills our website contact form, I copy the details into Google Sheets and send them a WhatsApp/email reply manually. ~30 leads/day. Use n8n.

## Output (abridged)

## Blueprint
Trigger: Webhook (form POST)
1. Set — normalise name/email/phone
2. Google Sheets — append row to `Leads`
3. IF — email present?
4. Gmail — send template reply
Error branch: Slack/Email to owner with payload.

Estimated: ~900 executions/month.
