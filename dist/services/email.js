"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWelcomeEmail = sendWelcomeEmail;
exports.sendPaymentSuccessEmail = sendPaymentSuccessEmail;
exports.sendPaymentFailedEmail = sendPaymentFailedEmail;
exports.sendPasswordResetEmail = sendPasswordResetEmail;
const resend_1 = require("resend");
let resend = null;
function getResend() {
    if (!resend) {
        if (!process.env.RESEND_API_KEY) {
            throw new Error('RESEND_API_KEY is not set in environment variables');
        }
        console.log('Initializing Resend client...');
        resend = new resend_1.Resend(process.env.RESEND_API_KEY);
    }
    return resend;
}
async function sendWelcomeEmail(email, name) {
    console.log(`Attempting to send welcome email to ${email}...`);
    try {
        const response = await getResend().emails.send({
            from: 'ResumoTube <noreply@resumotube.com.br>',
            to: email,
            subject: 'Bem-vindo ao ResumoTube!',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h1 style="color: #4F46E5;">Bem-vindo ao ResumoTube!</h1>
                    <p>Olá ${name},</p>
                    <p>Obrigado por se juntar ao ResumoTube! Estamos muito felizes em ter você conosco.</p>
                    <p>Com o ResumoTube, você pode:</p>
                    <ul>
                        <li>Receber resumos automáticos dos seus canais favoritos do YouTube</li>
                        <li>Pesquisar em todo o conteúdo dos seus canais</li>
                        <li>Manter um histórico organizado dos seus resumos</li>
                    </ul>
                    <p>Se você tiver alguma dúvida, não hesite em nos contatar.</p>
                    <p>Atenciosamente,<br>Equipe ResumoTube</p>
                </div>
            `
        });
        console.log('Welcome email sent successfully:', response);
    }
    catch (error) {
        console.error('Error sending welcome email:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            email,
            name
        });
        throw error; // Re-throw to handle it in the calling function
    }
}
async function sendPaymentSuccessEmail(email, name, planName) {
    console.log(`Attempting to send payment success email to ${email} for plan ${planName}...`);
    try {
        const response = await getResend().emails.send({
            from: 'ResumoTube <noreply@resumotube.com.br>',
            to: email,
            subject: 'Pagamento Confirmado - ResumoTube',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h1 style="color: #4F46E5;">Pagamento Confirmado!</h1>
                    <p>Olá ${name},</p>
                    <p>Seu pagamento para o plano ${planName} foi confirmado com sucesso!</p>
                    <p>Agora você tem acesso completo a todas as funcionalidades do ResumoTube.</p>
                    <p>Se você tiver alguma dúvida, não hesite em nos contatar.</p>
                    <p>Atenciosamente,<br>Equipe ResumoTube</p>
                </div>
            `
        });
        console.log('Payment success email sent successfully:', response);
    }
    catch (error) {
        console.error('Error sending payment success email:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            email,
            name,
            planName
        });
        throw error;
    }
}
async function sendPaymentFailedEmail(email, name) {
    console.log(`Attempting to send payment failed email to ${email}...`);
    try {
        const response = await getResend().emails.send({
            from: 'ResumoTube <noreply@resumotube.com.br>',
            to: email,
            subject: 'Falha no Pagamento - ResumoTube',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h1 style="color: #EF4444;">Falha no Pagamento</h1>
                    <p>Olá ${name},</p>
                    <p>Infelizmente, houve um problema com seu pagamento.</p>
                    <p>Por favor, tente novamente ou entre em contato com nosso suporte se o problema persistir.</p>
                    <p>Atenciosamente,<br>Equipe ResumoTube</p>
                </div>
            `
        });
        console.log('Payment failed email sent successfully:', response);
    }
    catch (error) {
        console.error('Error sending payment failed email:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            email,
            name
        });
        throw error;
    }
}
async function sendPasswordResetEmail(email, resetToken) {
    console.log(`Attempting to send password reset email to ${email}...`);
    try {
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;
        console.log('Reset URL:', resetUrl);
        const response = await getResend().emails.send({
            from: 'ResumoTube <noreply@resumotube.com.br>',
            to: email,
            subject: 'Redefinição de Senha - ResumoTube',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h1 style="color: #4F46E5;">Redefinição de Senha</h1>
                    <p>Você solicitou a redefinição de sua senha.</p>
                    <p>Clique no link abaixo para criar uma nova senha:</p>
                    <p>
                        <a href="${resetUrl}" style="display: inline-block; background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                            Redefinir Senha
                        </a>
                    </p>
                    <p>Este link expirará em 1 hora.</p>
                    <p>Se você não solicitou esta redefinição, por favor ignore este email.</p>
                    <p>Atenciosamente,<br>Equipe ResumoTube</p>
                </div>
            `
        });
        console.log('Password reset email sent successfully:', response);
    }
    catch (error) {
        console.error('Error sending password reset email:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            email,
            resetToken: resetToken.substring(0, 10) + '...' // Log only part of the token for security
        });
        throw error;
    }
}
