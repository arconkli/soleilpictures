// legalContent.js — the full text of Soleil Clusters' legal documents,
// authored as structured data so LegalPage.jsx stays a simple renderer.
//
// Shape:
//   LEGAL_DOCS[slug] = { slug, title, intro, sections: [{ heading, blocks }] }
// A block is either a paragraph string or { list: [string, …] } for bullets.
// The renderer linkifies any occurrence of CONTACT_EMAIL as a mailto: link.
//
// These are a thorough, good-faith draft tailored to how the app actually
// works (Supabase auth/storage, Stripe billing, Cloudflare hosting/analytics,
// Meta Pixel + Conversions API, realtime collaboration, AI auto-tagging).
// They are not legal advice; have counsel review before relying on them.

export const CONTACT_EMAIL = 'clusters@soleilpictures.com';
export const LAST_UPDATED = 'June 1, 2026';
export const COMPANY = 'Soleil Pictures';

export const DOC_ORDER = ['privacy', 'terms', 'cookies'];
export const DOC_LABELS = {
  privacy: 'Privacy',
  terms: 'Terms',
  cookies: 'Cookies',
};

const privacy = {
  slug: 'privacy',
  title: 'Privacy Policy',
  intro:
    "This Privacy Policy explains how Soleil Pictures (\"Soleil,\" \"we,\" \"us,\" or \"our\") collects, uses, and shares information when you use Soleil Clusters (the \"Service\"), available at clusters.soleilpictures.com. By using the Service, you agree to this Policy.",
  sections: [
    {
      heading: '1. Information We Collect',
      blocks: [
        'We collect the following categories of information:',
        {
          list: [
            'Account information. When you sign in we collect your email address. We use a one-time passcode (OTP) sent to your email instead of a password, so we do not collect or store a password.',
            'Content you create. The boards, canvases, notes, documents, comments, tags, and files you upload — including images, video, audio, and other media — along with their titles, descriptions, and arrangement on the canvas.',
            'Collaboration data. When you share a board, invite collaborators, or create public links, we process the information needed to provide those features, including collaborators’ email addresses and presence or activity within a shared workspace.',
            'Payment information. If you subscribe to a paid plan, our payment processor (Stripe) collects and processes your payment details. We do not receive or store full card numbers; we keep limited billing metadata such as your subscription status, plan, and customer and subscription identifiers.',
            'Usage and device information. Pages and features used, actions taken, approximate time spent, referring and exit pages, browser and device type, operating system, language, and IP address. We collect this through our own logging and through the analytics and advertising tools described below.',
            'Cookies and similar technologies. We and our partners use cookies, local storage, and similar identifiers. See our Cookie Policy for details.',
          ],
        },
      ],
    },
    {
      heading: '2. How We Use Information',
      blocks: [
        'We use information to:',
        {
          list: [
            'provide, operate, and maintain the Service;',
            'authenticate you and keep your account secure;',
            'store, sync, and display your content across your devices and to the collaborators you choose;',
            'process payments and manage subscriptions;',
            'provide customer support and respond to your requests;',
            'understand how the Service is used so we can improve it;',
            'measure and optimize our marketing and advertising;',
            'detect, prevent, and address fraud, abuse, and security issues; and',
            'comply with legal obligations and enforce our Terms.',
          ],
        },
      ],
    },
    {
      heading: '3. Automated Processing of Your Content',
      blocks: [
        'To help you organize your work, the Service may use automated and machine-learning tools to analyze media you upload — for example, to generate suggested tags or labels. This processing is performed to provide Service features. We do not use Your Content to train third-party AI models for unrelated purposes.',
      ],
    },
    {
      heading: '4. How We Share Information',
      blocks: [
        'We do not sell your personal information. We share information only as described here.',
        'Service providers and subprocessors. We use trusted providers to run the Service:',
        {
          list: [
            'Supabase — authentication, database, and file storage.',
            'Stripe — payment processing and subscription billing.',
            'Cloudflare — hosting, content delivery, media storage, and privacy-focused web analytics.',
            'Meta Platforms (Facebook and Instagram) — advertising measurement and optimization through the Meta Pixel and Conversions API.',
            'Realtime collaboration infrastructure — to power live, multi-user editing and presence.',
          ],
        },
        'With other users. Content you place in a shared workspace or behind a public link is visible to the people you share it with, or to anyone who has the link.',
        'Legal and safety. We may disclose information if required by law, regulation, legal process, or governmental request, or where we believe disclosure is necessary to protect the rights, property, or safety of Soleil, our users, or the public.',
        'Business transfers. If we are involved in a merger, acquisition, financing, or sale of assets, your information may be transferred as part of that transaction.',
      ],
    },
    {
      heading: '5. Advertising and Analytics',
      blocks: [
        'We use the Meta Pixel and the Meta Conversions API to measure the effectiveness of our advertising and to understand how visitors arrive at and use the Service. This can involve sharing limited event data — such as page views, sign-ups, and purchases, along with identifiers like a hashed email or an ad click ID — with Meta.',
        'We also use Cloudflare Web Analytics, which is designed to measure traffic without using cookies to track individuals across sites. See our Cookie Policy and the “Your Rights and Choices” section below for how to limit this.',
      ],
    },
    {
      heading: '6. Data Retention',
      blocks: [
        'We retain your information for as long as your account is active or as needed to provide the Service. We may retain certain information where required by law, to resolve disputes, prevent abuse, and enforce our agreements. When you delete content or close your account, we delete or de-identify the associated personal information within a reasonable period, except where retention is required.',
      ],
    },
    {
      heading: '7. Security',
      blocks: [
        'We use technical and organizational measures designed to protect your information, including encryption in transit and access controls. No method of transmission or storage is completely secure, so we cannot guarantee absolute security. You are responsible for keeping access to your email account secure, since it is used to sign you in.',
      ],
    },
    {
      heading: '8. Your Rights and Choices',
      blocks: [
        'Depending on where you live, you may have rights regarding your personal information, including the right to access, correct, delete, or receive a copy of it, and to object to or restrict certain processing.',
        'California (CCPA/CPRA). California residents may have the right to know what personal information we collect, to access or delete it, to correct inaccuracies, and to opt out of the “sharing” of personal information for cross-context behavioral advertising. We do not sell personal information. We will not discriminate against you for exercising these rights.',
        'EEA and UK (GDPR). If you are in the European Economic Area or the United Kingdom, you have rights to access, rectify, erase, restrict, and port your data, and to object to certain processing. Our legal bases for processing include performing our contract with you, your consent (for example, for certain advertising cookies), and our legitimate interests in operating and improving the Service.',
        'Other U.S. states. Residents of states with comprehensive privacy laws may have similar rights.',
        'To exercise any of these rights, email us at ' + CONTACT_EMAIL + '. You can also limit certain advertising as described in our Cookie Policy.',
      ],
    },
    {
      heading: '9. International Data Transfers',
      blocks: [
        'We are based in the United States and process information there. If you access the Service from outside the U.S., you understand that your information may be transferred to, stored in, and processed in the United States and other countries whose data-protection laws may differ from those of your country.',
      ],
    },
    {
      heading: '10. Children’s Privacy',
      blocks: [
        'The Service is not directed to children under 13 (or the minimum age required in your country, such as 16 in parts of the EEA). We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, contact us and we will delete it.',
      ],
    },
    {
      heading: '11. Changes to This Policy',
      blocks: [
        'We may update this Policy from time to time. If we make material changes, we will update the “Last updated” date above and, where appropriate, provide additional notice. Your continued use of the Service after changes take effect means you accept the updated Policy.',
      ],
    },
    {
      heading: '12. Contact Us',
      blocks: [
        'If you have questions about this Policy or your information, email us at ' + CONTACT_EMAIL + '.',
      ],
    },
  ],
};

const terms = {
  slug: 'terms',
  title: 'Terms of Service',
  intro:
    "These Terms of Service (\"Terms\") are a binding agreement between you and Soleil Pictures (\"Soleil,\" \"we,\" \"us,\" or \"our\") and govern your use of Soleil Clusters (the \"Service\"). By creating an account or using the Service, you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Service.",
  sections: [
    {
      heading: '1. Eligibility and Accounts',
      blocks: [
        'You must be at least 13 years old (or the minimum age of digital consent in your country) to use the Service. You are responsible for the activity on your account and for keeping access to your email secure, since we use one-time passcodes to sign you in. Notify us promptly of any unauthorized use of your account.',
      ],
    },
    {
      heading: '2. The Service',
      blocks: [
        'Soleil Clusters is a collaborative canvas for organizing creative and production work — boards, media, notes, documents, and related tools. We are continually improving the Service and may add, change, or remove features over time.',
      ],
    },
    {
      heading: '3. Plans, Billing, and Cancellation',
      blocks: [
        'The Service offers a free Demo plan and a paid Creator subscription. Paid subscriptions are billed in advance on a recurring basis (monthly or annually) through our payment processor, Stripe, and renew automatically until cancelled.',
        'You can cancel at any time. Cancellation takes effect at the end of your current billing period, and you keep paid access until then. Except where required by law, payments are non-refundable and we do not provide refunds or credits for partial billing periods.',
        'We may change our prices. We will give you advance notice, and price changes apply to the next billing period.',
      ],
    },
    {
      heading: '4. Your Content',
      blocks: [
        'You retain all ownership rights to the content you create or upload (“Your Content”). You grant Soleil a worldwide, non-exclusive, royalty-free license to host, store, reproduce, modify (for example, to create thumbnails or to format media for display), and distribute Your Content solely as needed to operate and provide the Service to you and to the collaborators you choose.',
        'You are responsible for Your Content. You represent that you have the rights necessary to upload and share it and that it does not infringe or violate the rights of any third party or any law.',
      ],
    },
    {
      heading: '5. Acceptable Use',
      blocks: [
        'You agree not to:',
        {
          list: [
            'break the law or infringe the intellectual-property, privacy, or other rights of others;',
            'upload or share content that is illegal, harmful, harassing, hateful, or that sexually exploits minors;',
            'attempt to access accounts, data, or systems that are not yours;',
            'interfere with, disrupt, overload, probe, or reverse-engineer the Service;',
            'use the Service to distribute spam, malware, or other harmful code; or',
            'misuse sharing or collaboration features to harm or deceive others.',
          ],
        },
        'We may remove content or suspend accounts that violate these rules.',
      ],
    },
    {
      heading: '6. Sharing and Collaboration',
      blocks: [
        'The Service lets you invite collaborators and create public links. You are responsible for what you choose to share and with whom. Anyone with a public link may be able to view the shared content, so share carefully.',
      ],
    },
    {
      heading: '7. Intellectual Property',
      blocks: [
        'The Service — including its software, design, and the Soleil and Clusters names and logos — is owned by Soleil and protected by intellectual-property laws. These Terms do not grant you any right to use our trademarks, logos, or branding.',
      ],
    },
    {
      heading: '8. Third-Party Services',
      blocks: [
        'The Service relies on third-party providers (such as Stripe, Supabase, and Cloudflare) and may link to third-party websites. We are not responsible for third-party services, and your use of them may be subject to their own terms and policies.',
      ],
    },
    {
      heading: '9. Disclaimers',
      blocks: [
        'The Service is provided “as is” and “as available,” without warranties of any kind, whether express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, secure, or error-free, or that any content will be preserved without loss. You are responsible for keeping your own backups of important content.',
      ],
    },
    {
      heading: '10. Limitation of Liability',
      blocks: [
        'To the fullest extent permitted by law, Soleil and its affiliates will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of data, profits, or goodwill, arising out of or relating to your use of the Service. Our total liability for any claim relating to the Service will not exceed the greater of the amount you paid us in the twelve months before the claim or one hundred U.S. dollars ($100).',
      ],
    },
    {
      heading: '11. Indemnification',
      blocks: [
        'You agree to indemnify and hold harmless Soleil from claims, damages, losses, and expenses (including reasonable attorneys’ fees) arising out of Your Content, your use of the Service, or your violation of these Terms or the rights of others.',
      ],
    },
    {
      heading: '12. Termination',
      blocks: [
        'You may stop using the Service at any time. We may suspend or terminate your access if you violate these Terms or if we reasonably believe it is necessary to protect the Service or other users. Upon termination, your right to use the Service ends. Provisions that by their nature should survive — such as content licenses for content you have already shared, disclaimers, limitations of liability, and indemnification — will survive.',
      ],
    },
    {
      heading: '13. Changes to These Terms',
      blocks: [
        'We may update these Terms from time to time. If we make material changes, we will update the “Last updated” date above and, where appropriate, provide additional notice. Your continued use of the Service after changes take effect means you accept the updated Terms.',
      ],
    },
    {
      heading: '14. Governing Law',
      blocks: [
        'These Terms are governed by the laws of the State of Georgia, U.S.A., without regard to its conflict-of-laws rules. You agree that the state and federal courts located in Georgia will have exclusive jurisdiction over any disputes arising out of or relating to these Terms or the Service.',
      ],
    },
    {
      heading: '15. Contact Us',
      blocks: [
        'Questions about these Terms? Email us at ' + CONTACT_EMAIL + '.',
      ],
    },
  ],
};

const cookies = {
  slug: 'cookies',
  title: 'Cookie Policy',
  intro:
    'This Cookie Policy explains how Soleil Clusters uses cookies, local storage, and similar technologies (together, “cookies”) when you use the Service. For more on how we handle personal information, see our Privacy Policy.',
  sections: [
    {
      heading: '1. What Are Cookies?',
      blocks: [
        'Cookies are small data files stored on your device. “Local storage” is a related browser technology that also stores data on your device. We use both to keep you signed in, remember your preferences, understand usage, and measure our advertising.',
      ],
    },
    {
      heading: '2. Categories of Cookies We Use',
      blocks: [
        {
          list: [
            'Strictly necessary. Required for the Service to function — for example, keeping you securely signed in. Our authentication provider (Supabase) stores your session in your browser’s local storage. The Service will not work properly without these.',
            'Functional. Remember your choices to improve your experience — for example, feature preferences and recently used fonts stored locally in your browser.',
            'Analytics. Help us understand how the Service is used so we can improve it. We use Cloudflare Web Analytics, which is designed to measure traffic without using cookies to track you across other websites.',
            'Advertising and measurement. Help us measure and optimize our marketing. We use the Meta Pixel, which may set cookies such as _fbp and store an ad click identifier (_fbc) from ad links, and we send related events to Meta through the Meta Conversions API.',
          ],
        },
      ],
    },
    {
      heading: '3. How to Control Cookies',
      blocks: [
        'Browser settings. Most browsers let you block or delete cookies and clear local storage. Note that blocking strictly necessary cookies or storage may prevent you from signing in or using parts of the Service.',
        'Advertising opt-outs. You can manage ad preferences in your Facebook and Instagram settings, and use industry opt-out tools — such as the Digital Advertising Alliance (optout.aboutads.info) or Your Online Choices (youronlinechoices.eu) — to limit interest-based advertising.',
        'Preference signals. Where required by law, we honor recognized browser opt-out preference signals, such as Global Privacy Control.',
      ],
    },
    {
      heading: '4. Changes to This Policy',
      blocks: [
        'We may update this Cookie Policy as our technologies or partners change. We will update the “Last updated” date above when we do.',
      ],
    },
    {
      heading: '5. Contact Us',
      blocks: [
        'Questions about our use of cookies? Email us at ' + CONTACT_EMAIL + '.',
      ],
    },
  ],
};

export const LEGAL_DOCS = { privacy, terms, cookies };
