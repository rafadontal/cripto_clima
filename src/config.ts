import { SubscriptionPlan } from './types';

// Ensure environment variables are loaded
if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set in environment variables');
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
    {
        id: 'basic',
        name: 'Básico',
        price: 40,
        tier: 'basic',
        maxChannels: 5,
        maxVideosPerMonth: 50,
        features: [
            'Até 5 canais',
            '50 resumos de vídeos por mês',
            'Suporte básico'
        ],
        paymentLink: 'https://buy.stripe.com/test_4gM5kF9Zs0HD8k4c9l2Nq00'
    },
    {
        id: 'pro',
        name: 'Profissional',
        price: 80,
        tier: 'pro',
        maxChannels: 15,
        maxVideosPerMonth: 200,
        features: [
            'Até 15 canais',
            '200 resumos de vídeos por mês',
            'Suporte prioritário',
            'Análises avançadas'
        ],
        paymentLink: 'https://buy.stripe.com/test_8x2dRb4F8gGB6bW8X92Nq01'
    },
    {
        id: 'premium',
        name: 'Premium',
        price: 130,
        tier: 'premium',
        maxChannels: 50,
        maxVideosPerMonth: 1000,
        features: [
            'Até 50 canais',
            '1000 resumos de vídeos por mês',
            'Suporte prioritário 24/7',
            'Análises avançadas',
            'Acesso à API'
        ],
        paymentLink: 'https://buy.stripe.com/test_4gM5kF5Jc1LHeIs1uH2Nq02'
    }
];

// Create a function to get the latest config
export function getStripeConfig() {
    return {
        secretKey: process.env.STRIPE_SECRET_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
        currency: 'brl',
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