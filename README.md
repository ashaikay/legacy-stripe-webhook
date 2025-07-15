import Stripe from 'stripe';
import { buffer } from 'micro';
import { createClient } from '@supabase/supabase-js';

// Stripe and Supabase client setup
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2022-11-15',
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Match Stripe Price IDs to subscription tiers (✅ YOUR IDs inserted)
const priceToTier = {
  'price_1RkxSULcg2C4zXM2TvEyVRZR': 'essentials', // Vault Essentials – £9.99/mo
  'price_1RkxTaLcg2C4zXM2F08hKe53': 'pro',        // Vault Pro – £20/mo
  'price_1RkxccLcg2C4zXM2YbPTC06m': 'legacy',     // Vault Legacy – £149/year
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

  // When payment is completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email;
    const priceId = session?.metadata?.price_id || session?.display_items?.[0]?.price?.id || session?.line_items?.[0]?.price?.id;

    const tier = priceToTier[priceId] || 'none';

    // Find user in Supabase
    const { data: user, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (error || !user) {
      console.error('❌ Supabase user not found for email:', email);
      return res.status(400).send('User not found');
    }

    // Update subscription_tier in profiles
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

