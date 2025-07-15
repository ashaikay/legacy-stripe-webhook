api/stripe-webhook.js
export default function handler(req, res) {
  res.json({ message: 'Webhook received!' });
}
