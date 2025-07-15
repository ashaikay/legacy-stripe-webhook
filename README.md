# legacy-stripe-webhook
import Stripe from 'stripe';
import { buffer } from 'micro';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2022-11-15',
});

// Supabase client using Service Role
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Price ID map
const priceToTier = {
  'price_abc123': 'essentials', // Replace with your actual Price ID
  'price_def456': 'pro',        // Replace with your actual Price ID
  'price_ghi789': 'legacy',     // Replace with your actual Price ID
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];

  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_SIGNING_SECRET
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ When payment is completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email;
    const priceId = session?.line_items?.[0]?.price?.id || session?.metadata?.price_id;
    const tier = priceToTier[priceId] || 'none';

    // 🔍 Find the user in Supabase by email
    const { data: user, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (error || !user) {
      console.error('❌ Supabase user not found:', email);
      return res.status(400).send('User not found');
    }

    // ✅ Update subscription tier
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ subscription_tier: tier })
      .eq('id', user.id);

    if (updateError) {
      console.error('❌ Failed to update subscription tier:', updateError);
      return res.status(500).send('Update failed');
    }

    console.log(`✅ Updated ${email} to tier: ${tier}`);
  }

  res.status(200).json({ received: true });
}
