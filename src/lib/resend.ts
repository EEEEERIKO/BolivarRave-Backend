import { Resend } from "resend";

let resendClient: Resend | null = null;

export const getResendClient = () => {
	if (!resendClient && process.env.RESEND_API_KEY) {
		resendClient = new Resend(process.env.RESEND_API_KEY);
	}

	return resendClient;
};