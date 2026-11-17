'use server';

export type EnquiryField =
  'fullName' | 'phone' | 'email' | 'service' | 'subject' | 'message' | 'consent';
export type EnquiryErrorCode = 'required' | 'phone' | 'email' | 'consent';

export type EnquiryState = {
  status: 'idle' | 'success' | 'error';
  errors?: Partial<Record<EnquiryField, EnquiryErrorCode>>;
};

const SERVICES = ['loans', 'advisory', 'funds', 'factoring'];

/** Rwandan mobile numbers: 07X XXX XXXX, optionally with +250 / 250 prefix. */
const RW_PHONE = /^(?:\+?250|0)?7[2389]\d{7}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitEnquiry(
  _prev: EnquiryState,
  formData: FormData,
): Promise<EnquiryState> {
  const get = (k: string) => String(formData.get(k) ?? '').trim();

  const data = {
    fullName: get('fullName'),
    phone: get('phone').replace(/[\s-]/g, ''),
    email: get('email'),
    service: get('service'),
    subject: get('subject'),
    message: get('message'),
    consent: formData.get('consent') === 'on',
  };

  const errors: EnquiryState['errors'] = {};
  if (!data.fullName) errors.fullName = 'required';
  if (!data.phone) errors.phone = 'required';
  else if (!RW_PHONE.test(data.phone)) errors.phone = 'phone';
  if (data.email && !EMAIL.test(data.email)) errors.email = 'email';
  if (!SERVICES.includes(data.service)) errors.service = 'required';
  if (!data.subject) errors.subject = 'required';
  if (!data.message) errors.message = 'required';
  if (!data.consent) errors.consent = 'consent';

  if (Object.keys(errors).length > 0) return { status: 'error', errors };

  // TODO(BF): Send to the backend API (POST /api/v1/enquiries) so it creates an
  // enquiry record for staff assignment and tracking (PRD §4.8, §12.9).
  // Add rate limiting / bot protection before launch.
  console.info('[enquiry] received', { service: data.service, at: new Date().toISOString() });

  return { status: 'success' };
}
