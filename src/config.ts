import { SubscriptionPlan } from './types';

// Ensure environment variables are loaded
if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set in environment variables');
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
    {
        id: 'basic',
        name: 'Basic',
        price: 9.99,
        tier: 'basic',
        maxChannels: 5,
        maxVideosPerMonth: 50,
        features: [
            'Up to 5 channels',
            '50 video summaries per month',
            'Basic support'
        ],
        paymentLink: 'https://buy.stripe.com/test_dRmcN7b2J7y13cm9mxcwg02'
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 19.99,
        tier: 'pro',
        maxChannels: 15,
        maxVideosPerMonth: 200,
        features: [
            'Up to 15 channels',
            '200 video summaries per month',
            'Priority support',
            'Advanced analytics'
        ],
        paymentLink: 'https://buy.stripe.com/test_eVq6oJ0o55pT5kuaqBcwg01'
    },
    {
        id: 'premium',
        name: 'Premium',
        price: 29.99,
        tier: 'premium',
        maxChannels: 50,
        maxVideosPerMonth: 1000,
        features: [
            'Up to 50 channels',
            '1000 video summaries per month',
            '24/7 priority support',
            'Advanced analytics',
            'API access'
        ],
        paymentLink: 'https://buy.stripe.com/test_5kQ4gBc6NcSlfZ8cyJcwg00'
    }
];

// Create a function to get the latest config
export function getStripeConfig() {
    return {
        secretKey: process.env.STRIPE_SECRET_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
        currency: 'eur',
        successUrl: `${process.env.FRONTEND_URL}/auth-callback.html`,
        cancelUrl: `${process.env.FRONTEND_URL}/landing.html`
    };
}

// Export the initial config
export const STRIPE_CONFIG = getStripeConfig();

// Validate Stripe configuration
if (!STRIPE_CONFIG.secretKey) {
    console.error('Stripe secret key is not configured');
}
if (!STRIPE_CONFIG.webhookSecret) {
    console.error('Stripe webhook secret is not configured');
} 