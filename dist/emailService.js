"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
exports.sendWelcomeEmail = sendWelcomeEmail;
exports.sendSubscriptionConfirmationEmail = sendSubscriptionConfirmationEmail;
exports.sendSubscriptionRenewalEmail = sendSubscriptionRenewalEmail;
exports.sendPasswordResetEmail = sendPasswordResetEmail;
exports.sendPasswordChangedEmail = sendPasswordChangedEmail;
const resend_1 = require("resend");
// Debug logging
console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'Present' : 'Missing');
console.log('RESEND_API_KEY length:', process.env.RESEND_API_KEY?.length);
if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is required. Please add it to your .env file.');
}
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
async function sendEmail({ to, subject, html }) {
    try {
        const data = await resend.emails.send({
            from: 'ResumoTube <noreply@resumotube.com.br>',
            to,
            subject,
            html
        });
        return { success: true, data };
    }
    catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error };
    }
}
async function sendWelcomeEmail(email, name) {
    const subject = 'Welcome to ResumoTube!';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #4F46E5;">Welcome to ResumoTube!</h1>
            <p>Hi ${name},</p>
            <p>Thank you for joining ResumoTube! We're excited to have you on board.</p>
            <p>With ResumoTube, you can:</p>
            <ul>
                <li>Get AI-powered summaries of YouTube videos</li>
                <li>Follow your favorite channels</li>
                <li>Search through video summaries</li>
                <li>And much more!</li>
            </ul>
            <p>If you have any questions, feel free to reply to this email.</p>
            <p>Best regards,<br>The ResumoTube Team</p>
        </div>
    `;
    return sendEmail({ to: email, subject, html });
}
async function sendSubscriptionConfirmationEmail(email, name, planName) {
    const subject = 'Your ResumoTube Subscription is Active!';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #4F46E5;">Subscription Confirmed!</h1>
            <p>Hi ${name},</p>
            <p>Thank you for subscribing to ResumoTube's ${planName} plan!</p>
            <p>Your subscription is now active, and you have access to all premium features:</p>
            <ul>
                <li>Unlimited video summaries</li>
                <li>Follow more channels</li>
                <li>Priority support</li>
            </ul>
            <p>If you have any questions about your subscription, feel free to reply to this email.</p>
            <p>Best regards,<br>The ResumoTube Team</p>
        </div>
    `;
    return sendEmail({ to: email, subject, html });
}
async function sendSubscriptionRenewalEmail(email, name, planName, renewalDate) {
    const subject = 'Your ResumoTube Subscription is Renewing Soon';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #4F46E5;">Subscription Renewal Notice</h1>
            <p>Hi ${name},</p>
            <p>Your ResumoTube ${planName} subscription will renew on ${renewalDate.toLocaleDateString()}.</p>
            <p>You don't need to do anything - we'll automatically charge your payment method.</p>
            <p>If you want to make any changes to your subscription, you can do so from your account settings.</p>
            <p>Best regards,<br>The ResumoTube Team</p>
        </div>
    `;
    return sendEmail({ to: email, subject, html });
}
async function sendPasswordResetEmail(email, name, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const subject = 'Reset Your ResumoTube Password';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #4F46E5;">Reset Your Password</h1>
            <p>Hi ${name},</p>
            <p>We received a request to reset your ResumoTube password.</p>
            <p>Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" 
                   style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
                    Reset Password
                </a>
            </div>
            <p>If you didn't request this, you can safely ignore this email.</p>
            <p>This link will expire in 1 hour.</p>
            <p>Best regards,<br>The ResumoTube Team</p>
        </div>
    `;
    return sendEmail({ to: email, subject, html });
}
async function sendPasswordChangedEmail(email, name) {
    const subject = 'Your ResumoTube Password Has Been Changed';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #4F46E5;">Password Changed</h1>
            <p>Hi ${name},</p>
            <p>Your ResumoTube password has been successfully changed.</p>
            <p>If you didn't make this change, please contact us immediately.</p>
            <p>Best regards,<br>The ResumoTube Team</p>
        </div>
    `;
    return sendEmail({ to: email, subject, html });
}
