// legalContent.js — the full text of Soleil Clusters' legal documents,
// authored as structured data so LegalPage.jsx stays a simple renderer.
//
// Shape:
//   LEGAL_DOCS[slug] = { slug, title, updated?, intro, sections: [{ heading, blocks }] }
// A block is either a paragraph string or { list: [string, …] } for bullets.
// The renderer linkifies any occurrence of CONTACT_EMAIL as a mailto: link.
//
// The text describes how the app works today: Supabase (auth, database,
// storage), Stripe billing, Cloudflare (hosting, files, live sync, Workers AI),
// Fly.io (media conversion, Scout), Resend email, Meta Pixel + Conversions API,
// our own first-party analytics, the REST API, the MCP server and OAuth apps.
// Every retention period in the Privacy Policy is held to the purge the
// database actually runs by src/lib/legalContent.test.mjs, and the draft
// lifetime by src/lib/mcpDrafts.test.mjs: change a purge, change the sentence.
// Bump a document's `updated` only when its own text changes.
// They are not legal advice; have counsel review before relying on them.

export const CONTACT_EMAIL = 'clusters@soleilpictures.com';
// The date a document shows unless it carries its own `updated`.
export const LAST_UPDATED = 'June 29, 2026';
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
  updated: 'November 10, 2026',
  intro:
    "This Privacy Policy explains how Soleil Pictures (\"Soleil,\" \"we,\" \"us,\" or \"our\") collects, uses, and shares information when you use Soleil Clusters (the \"Service\"), available at clusters.soleilpictures.com, including through our API, our MCP server, and the AI assistants and other apps you connect to it. By using the Service, you agree to this Policy.",
  sections: [
    {
      heading: '1. Information We Collect',
      blocks: [
        'We collect the following categories of information:',
        {
          list: [
            'Account information. When you sign in we collect your email address. We use a one-time passcode (OTP) sent to your email instead of a password, so we do not collect or store a password. If you add a passkey, we store its public key and the name of the device it was made on — never your fingerprint, your face, or the passkey’s private key, which stay on your device. To understand who uses the Service, we also group addresses by the kind of provider they come from — a personal email service, a school or university, or an organization’s own domain — and, for a school or university, by the institution.',
            'Content you create. The clusters, canvases, notes, documents, comments, tags, and files you upload — including images, video, audio, and other media — along with their titles, descriptions, and arrangement on the canvas, and the descriptions our AI features make of your pictures (see section 3).',
            'Drafts made through an AI assistant. An assistant connected to the no-account address (clusters.soleilpictures.com/mcp) can build a draft cluster for someone who is not signed in. A draft stores what the assistant puts in it (the cards, pictures and text), a one-way hash of the access key the assistant passes back (and, for ChatGPT, of its anonymous user identifier), which kind of assistant made it, when it was last used, and a count of its requests in the hour. If nobody keeps it, it is deleted 30 days after its last change, and the hashed record of its key is removed 90 days after that; keeping it takes an email address and a one-time passcode, and the cluster then belongs to that account.',
            'Apps and AI assistants you connect. When you connect an app or AI assistant to your account, we keep a record of the app (the name, website, logo and version it gives us, the addresses it may return you to, and the IP address it registered from), what you allowed it to do, and when. When it acts on your account through our API or MCP server, we log each call: which connection made it, the route or tool, the response status and how long it took, the IP address and user agent, whether the call failed and the short error code it failed with, and, on an assistant’s first message of a session, the name and version the app reports for itself. Section 4 explains this in full.',
            'Collaboration data. When you share a cluster, invite collaborators, or create public links, we process the information needed to provide those features, including collaborators’ email addresses and presence or activity within a shared workspace. When you invite someone who does not have an account, we email them at the address you give us. If you take part in our referral program, we also process the email address you use to invite someone and the information needed to determine reward eligibility.',
            'Payment information. If you subscribe to a paid plan, our payment processor (Stripe) collects and processes your payment details. We do not receive or store full card numbers; we keep limited billing metadata such as your subscription status, plan, and customer and subscription identifiers.',
            'Email activity. When we email you, our email provider tells us whether the message was delivered or bounced, and whether it was opened or a link in it was clicked. We use this to keep our email reaching people and to understand which messages are useful.',
            'Answers you choose to give. The app occasionally asks a short, optional question — such as what brings you back, what best describes you, your age range, or what is holding you back from upgrading — and stores the answer you pick, and anything you choose to write, with your account. We ask for an age range (such as 25–34), never your date of birth.',
            'Usage and device information. Pages and features used, actions taken, approximate time spent, referring and exit pages, browser and device type and version, operating system, language and time zone, IP address, and the approximate location derived from it (country and region, such as a state or province — never a city). Once per visit we also record your device’s general setup: screen and window size, whether it has touch or a mouse, the display and accessibility preferences your browser shares (such as dark mode or reduced motion), its approximate memory, processor count and connection type, whether you are using the installed app, and the kind of network you connect from — a home or mobile provider, a university or research network, a VPN or relay service, or a data center — never the network’s name. To recognize a returning browser we keep a random identifier in your browser’s storage, and to prevent abuse we keep one-way hashes of the network and browser a request came from. When something in the Service fails, we record what failed, where, and the names of the steps just before it — never the content you create. We collect this through our own logging and analytics and through the advertising tools described below.',
            'Layout outlines, if you agree. If you say yes when the app asks “Help improve Clusters?”, or turn on Settings › Profile › Keep outlines of how my clusters are laid out, we keep an outline of each cluster you made on or after November 10, 2026: once in the week you say yes, then once in each week the cluster changes. An outline is a set of plain boxes, one for each card, showing where it sits, how big it is, how far it is turned, what kind of card it is and the order the cards were added, plus the boxes of its sections, how many boxes a grid card has, how many cards the cluster holds, how deeply it is nested, how many clusters sit inside it and roughly how old it is. An outline holds nothing that is in your cards (no pictures, words, names, colors, links, file names or sizes). It is stored without anything that links it to you, your workspace or the cluster, and we never try to link one back. A shared cluster is left out if anyone who can edit it says no, and clusters that are published or have a public link (and the clusters inside them) and clusters in Team workspaces are always left out.',
            'Marketing and attribution information. When you arrive from a link or advertisement, we collect campaign parameters (such as UTM tags), referral codes, and ad-click identifiers from advertising networks — for example Google, Meta, Microsoft (Bing), TikTok, Reddit, X, LinkedIn, Pinterest, and Snapchat — so we can understand how you found us and measure the effectiveness of our marketing.',
            'Scout text messages (where offered). If you sign up to send things to Clusters by text message, we collect your phone number, your consent and the version of the wording you agreed to, your country, a one-way hash of your IP address, and the campaign that brought you. The pictures, links, notes and voice notes you send become cards in your account; voice notes are transcribed, and a photo keeps the time and place it was taken if the photo carries them. Your number is used only to run Scout. It is never sold or shared for marketing. Reply STOP at any time to stop receiving messages.',
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
            'carry out the requests of the apps and AI assistants you connect;',
            'process payments and manage subscriptions;',
            'provide customer support and respond to your requests;',
            'send you transactional and service messages and, where permitted, lifecycle and product or marketing emails that you can unsubscribe from at any time;',
            'understand how the Service is used so we can improve it;',
            'if you agree to layout outlines, learn from them how people lay out their clusters, so we can improve the Service;',
            'measure and optimize our marketing and advertising;',
            'detect, prevent, and address fraud, abuse, and security issues; and',
            'comply with legal obligations and enforce our Terms.',
          ],
        },
      ],
    },
    {
      heading: '3. AI Features',
      blocks: [
        'Some features use AI to help you organize and find your work. All of this processing runs on Cloudflare Workers AI, operated by our hosting provider Cloudflare on our behalf:',
        {
          list: [
            'Text. The text of your cards and documents is turned into a numeric summary so we can find related items and suggest tags.',
            'Pictures. A small copy of each picture you upload is read to write a short description, keywords and labels, and to pick out any text in the picture. These are stored with the picture so you can search for it. When you publish a cluster, a picture’s description may be used as its alt text, which anyone who can see the published cluster can read.',
            'Voice notes. Voice notes sent through Scout are transcribed into text.',
          ],
        },
        'We do not use your content to train AI models, and Cloudflare does not use it to train theirs. The owner or a co-owner of a workspace can turn these features off in Settings › Workspace › AI suggestions. While they are off, nothing from that workspace is sent for AI processing, and the picture descriptions already made are deleted.',
        'AI assistants you connect yourself, such as Claude or ChatGPT, are separate from these features and are described in section 4.',
      ],
    },
    {
      heading: '4. Apps and AI Assistants You Connect',
      blocks: [
        'You can connect an AI assistant (such as Claude or ChatGPT) or another app to your account through our MCP server or our REST API. You sign in to Clusters and approve the connection on a consent screen before the app can reach your account. Without an account, an assistant can only make a new draft cluster through clusters.soleilpictures.com/mcp; section 1 describes what a draft stores and when it is deleted.',
        {
          list: [
            'What it can reach. Only what you approve: reading (seeing the clusters, cards, documents, comments and tags you can open), writing (making and changing them), and deleting, which is off unless you tick it on the consent screen. An app can never do more than your own account can.',
            'What we receive. Only what the app puts in its requests to Clusters, such as a search, the text of a card it adds, or a link to import. We never ask for or receive your conversation history, your other chats, or the assistant’s memory.',
            'Where your content goes. What the app reads from Clusters is sent to that app, and through it to the company that runs it — for an AI assistant, the assistant’s provider, such as Anthropic or OpenAI. From there it is handled under that company’s terms and privacy policy, which we do not control.',
            'What we keep. The record of the connection and the log of its calls described in section 1. Records of calls are deleted after 30 days. Access tokens are stored only as one-way hashes and expire on their own; the connection lasts until you disconnect it.',
            'How we use it. To carry out the app’s requests, enforce limits, keep your account secure, and fix problems. We never use it for advertising, sell it, use it to build a profile of you, or use it to train AI models.',
            'How to disconnect. Settings › Connections › Connected apps lists every app connected to your account; disconnecting one ends its access at once and cancels its tokens. The record that the connection existed is kept, marked as ended, and its call records are deleted on the schedule above. Deleting your account ends every connection.',
            'Webhooks. If you set up a webhook, we send the web address you choose a notice when something changes, carrying identifiers, counts and cluster names — not the text of your cards or comments. Webhook delivery records are deleted after 30 days.',
          ],
        },
        'Questions about connected apps? Email us at ' + CONTACT_EMAIL + '.',
      ],
    },
    {
      heading: '5. How We Share Information',
      blocks: [
        'We do not sell your personal information. We share information only as described here.',
        'Service providers and subprocessors. We use trusted providers to run the Service:',
        {
          list: [
            'Supabase — authentication, database, and file storage.',
            'Stripe — payment processing and subscription billing.',
            'Resend — sending transactional, lifecycle, and product emails, and telling us whether they were delivered, opened or clicked.',
            'Cloudflare — hosting, content delivery, file storage and backups, live multi-user editing and presence, bot checks, and the AI features in section 3 (Workers AI).',
            'Fly.io — converting uploaded video and audio into versions every browser can play, and running Scout.',
            'Our text-messaging provider — sending and receiving Scout messages, where Scout is offered.',
            'Meta Platforms (Facebook and Instagram) — advertising measurement and optimization through the Meta Pixel and Conversions API.',
          ],
        },
        'Content loaded from other services. Some fonts load from Adobe Fonts and Google Fonts; a YouTube, Vimeo, Spotify, TikTok, Instagram or X link shown as a player loads from that service; and pictures and previews that people link into a cluster load from the sites that host them. Your browser contacts those services directly, so they receive your IP address and browser details under their own policies. When you paste a link, our servers fetch that page to make a preview, so the site sees our servers rather than you.',
        'Apps you connect and webhooks you set up. They receive what you direct them to, as described in section 4.',
        'With other users. Content you place in a shared workspace or behind a public link is visible to the people you share it with, or to anyone who has the link. A cluster you publish to Explore is public and can appear in search engines. The owner and co-owners of a workspace can see what is in it. In a Team, the team’s owner and admins can open every team workspace, including private ones, and can see members’ email addresses.',
        'Legal and safety. We may disclose information if required by law, regulation, legal process, or governmental request, or where we believe disclosure is necessary to protect the rights, property, or safety of Soleil, our users, or the public.',
        'Business transfers. If we are involved in a merger, acquisition, financing, or sale of assets, your information may be transferred as part of that transaction.',
      ],
    },
    {
      heading: '6. Advertising and Analytics',
      blocks: [
        'We use the Meta Pixel and the Meta Conversions API to measure the effectiveness of our advertising and to understand how visitors arrive at and use the Service. This can involve sharing limited event data — such as page views, sign-ups, and purchases, along with identifiers like a hashed email or an ad click ID — with Meta.',
        'If your browser sends the Global Privacy Control signal, we treat it as a request to opt out of this sharing, wherever you are: we do not load the Meta Pixel, and we do not send your sign-ups, checkouts or purchases to the Meta Conversions API.',
        'We also do not load the Meta Pixel on a page whose address holds a private link — a shared cluster, file or template, an invitation, or a sign-in link we emailed you — or on the next page you open from it, so that address is never shared with Meta.',
        'When you reach the Service from other advertising networks (for example Google, Microsoft, TikTok, Reddit, X, LinkedIn, Pinterest, or Snapchat), we may receive and record the ad-click identifier from that link so we can attribute the visit and measure how our campaigns perform.',
        'Our product analytics are our own: the Service records the usage information in section 1 to our own database, using a random identifier kept in your browser’s storage. We do not use a third-party analytics service. See our Cookie Policy and the “Your Rights and Choices” section below for how to limit this.',
      ],
    },
    {
      heading: '7. Data Retention',
      blocks: [
        'We keep your account and your content while your account is open, and for as long as needed to provide the Service. Some records are deleted automatically after a set period:',
        {
          list: [
            'Clusters, comments, tags and votes you delete stay in Trash for 30 days, then are permanently deleted.',
            'Draft clusters made by an AI assistant that nobody keeps: see section 1.',
            'Records of calls made through the API or by a connected app: 30 days.',
            'Webhook delivery records: 30 days.',
            'Records of errors in the Service: 90 days.',
            'Usage events and visit records: 400 days.',
            'Layout outlines: 400 days.',
            'Hashed network and browser records kept to prevent abuse: 365 days.',
          ],
        },
        'Other records, such as email delivery and open records, security records, app registrations, and Scout sign-ups, have no set period. We keep them only as long as they are needed for the purposes in this Policy.',
        'Deleting your account. You can delete your account yourself in Settings › Profile (if you own a Team, close the team first). It takes effect immediately and cannot be undone. Workspaces that nobody else can edit are deleted with everything in them. A workspace that others can edit passes to a co-owner or its longest-standing editor, so their work is not lost. Any subscription is cancelled, and your usage and error records are de-identified. Comments, tags and votes you left in other people’s clusters stay, with your name removed. Records of the emails we sent you and a Scout sign-up (your number and consent) are not removed automatically; email us and we will delete them. Stripe keeps the payment records it is required to keep. If Settings does not let you delete your account, email us.',
        'Backups. We keep a backup copy of uploaded files so we can recover from loss. Deleting a file or an account does not currently remove its backup copy. Our database provider also keeps backups of the database for a limited time, which can hold deleted information until they are replaced. Backups are stored securely, used only to restore lost data, and not used for anything else.',
        'We may keep certain information longer where required by law, to resolve disputes, prevent abuse, and enforce our agreements.',
      ],
    },
    {
      heading: '8. Security',
      blocks: [
        'We use technical and organizational measures designed to protect your information, including encryption in transit and access controls. Access tokens for connected apps and API keys are stored only as one-way hashes, and you can disconnect any app at any time. You can sign in with a passkey instead of an emailed code. No method of transmission or storage is completely secure, so we cannot guarantee absolute security. You are responsible for keeping access to your email account secure, since it is used to sign you in.',
      ],
    },
    {
      heading: '9. Your Rights and Choices',
      blocks: [
        'Many choices you can make yourself, at any time:',
        {
          list: [
            'Get a copy. Export clusters as images or PDF, documents as PDF, Markdown and other formats, download your original files, or read everything through the API.',
            'Delete. Delete content (it stays in Trash for 30 days), or delete your account in Settings › Profile.',
            'Disconnect apps. Settings › Connections › Connected apps.',
            'Drafts. A draft cluster an assistant made that nobody keeps is deleted on its own; email us to remove one sooner.',
            'Turn off AI features. Settings › Workspace › AI suggestions (workspace owner or co-owner).',
            'Layout outlines. Say yes or no when the app asks, or change your answer at any time in Settings › Profile. Turning it off leaves your clusters out of every outline made after that. Outlines already made are not removed early: nothing in them points back to you, so we keep no way to pick out yours. Like every outline, they are deleted after 400 days.',
            'Email. Use the unsubscribe link in any lifecycle or activity email.',
            'Advertising. Send the Global Privacy Control signal, or use the controls in our Cookie Policy.',
            'Scout. Reply STOP.',
          ],
        },
        'Depending on where you live, you may have rights regarding your personal information, including the right to access, correct, delete, or receive a copy of it, and to object to or restrict certain processing.',
        'California (CCPA/CPRA). California residents may have the right to know what personal information we collect, to access or delete it, to correct inaccuracies, and to opt out of the “sharing” of personal information for cross-context behavioral advertising. We do not sell personal information. We will not discriminate against you for exercising these rights.',
        'EEA and UK (GDPR). If you are in the European Economic Area or the United Kingdom, you have rights to access, rectify, erase, restrict, and port your data, and to object to certain processing. Our legal bases for processing include performing our contract with you, your consent (for example, for certain advertising cookies), and our legitimate interests in operating and improving the Service.',
        'Other U.S. states. Residents of states with comprehensive privacy laws may have similar rights.',
        'To exercise any of these rights, email us at ' + CONTACT_EMAIL + '. You can also limit certain advertising as described in our Cookie Policy.',
      ],
    },
    {
      heading: '10. International Data Transfers',
      blocks: [
        'We are based in the United States and process information there. If you access the Service from outside the U.S., you understand that your information may be transferred to, stored in, and processed in the United States and other countries whose data-protection laws may differ from those of your country.',
      ],
    },
    {
      heading: '11. Children’s Privacy',
      blocks: [
        'The Service is not directed to children under 13 (or the minimum age required in your country, such as 16 in parts of the EEA). We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, contact us and we will delete it.',
      ],
    },
    {
      heading: '12. Changes to This Policy',
      blocks: [
        'We may update this Policy from time to time. If we make material changes, we will update the “Last updated” date above and, where appropriate, provide additional notice. Your continued use of the Service after changes take effect means you accept the updated Policy.',
      ],
    },
    {
      heading: '13. Contact Us',
      blocks: [
        'If you have questions about this Policy or your information, email us at ' + CONTACT_EMAIL + '. Soleil Pictures is based in the State of Georgia, U.S.A.',
      ],
    },
  ],
};

const terms = {
  slug: 'terms',
  title: 'Terms of Service',
  updated: 'November 10, 2026',
  intro:
    "These Terms of Service (\"Terms\") are a binding agreement between you and Soleil Pictures (\"Soleil,\" \"we,\" \"us,\" or \"our\") and govern your use of Soleil Clusters (the \"Service\"), including through our API, our MCP server, and any app or AI assistant you connect to it. By creating an account or using the Service, you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Service.",
  sections: [
    {
      heading: '1. Eligibility and Accounts',
      blocks: [
        'You must be at least 13 years old (or the minimum age of digital consent in your country) to use the Service. You are responsible for the activity on your account, including activity by apps you connect to it, and for keeping access to your email secure, since we use one-time passcodes to sign you in. Notify us promptly of any unauthorized use of your account.',
        'If you use the Service on behalf of an organization, you confirm that you are authorized to accept these Terms for it.',
        'An AI assistant can make a draft cluster before you have an account. When you keep a draft by signing in with your email, it becomes part of your account and these Terms apply to it.',
      ],
    },
    {
      heading: '2. The Service',
      blocks: [
        'Soleil Clusters is a collaborative canvas for organizing creative and production work — clusters, media, notes, documents, and related tools. It includes our REST API and MCP server, AI features that help organize your work, Explore (a public gallery of published clusters), and, where offered, Scout (sending things to Clusters by text message). We are continually improving the Service and may add, change, or remove features over time.',
      ],
    },
    {
      heading: '3. Plans, Billing, and Cancellation',
      blocks: [
        'Plans. The Service offers a free plan and two paid plans: Creator, billed monthly or annually, and Team, billed per seat. In a Team, every person who can edit in the team’s workspaces holds a seat; people who can only view are free. Current prices and limits are shown on our pricing page and before you pay.',
        'Whose plan applies. Cards and storage in a workspace count against the plan of the workspace’s owner, not the person who adds them.',
        'Billing. Paid plans are billed in advance on a recurring basis through our payment processor, Stripe, and renew automatically until cancelled. Prices may not include taxes, which are your responsibility where they apply.',
        'Free trials. A free trial needs a payment method. When the trial ends, your subscription starts and you are charged automatically unless you cancel before the trial ends; cancelling before then costs nothing. We email you before the first charge. Each account can have one free trial of each plan.',
        'Seats and add-ons. Extra storage on Creator and extra Team seats are charged for the rest of the current billing period (seats added during a trial are billed from the first invoice), and we show you the price before you confirm. Extra storage ends if the plan it was added to ends.',
        'Promotion codes. A promotion code applies only as described when you use it at checkout.',
        'Cancelling. You can cancel at any time. Cancellation takes effect at the end of your current billing period, and you keep paid access until then. Except where required by law or where we decide otherwise, payments are non-refundable and we do not provide refunds or credits for partial billing periods.',
        'Failed payments. If we still cannot collect a payment for Creator after our payment processor’s retries, your account moves to the free plan. If we cannot collect a payment for Team, everyone keeps editing for a grace period; after it, the team’s workspaces can be opened but not edited until the payment is made. If a payment is reversed or disputed, we may end the paid features it paid for.',
        'Limits never delete your work. If you go over a plan’s limits — because a plan ended, a payment failed, or a limit changed — nothing you already have is deleted or hidden; you can keep opening and editing it, but new cards or uploads will not fit until you are back under the limit or upgrade. The one exception is the Team grace period above: after it, a team’s workspaces stay fully openable but cannot be edited until the payment is made.',
        'Changes. We may change our prices and plan limits. We will give you advance notice of a price change, and it applies from your next billing period.',
        'Referral and promotional rewards. We may offer referral or promotional rewards, such as bonus cards or storage. Rewards are subject to eligibility conditions, may be changed or withdrawn at any time, have no cash value, and may be reduced or revoked if we believe they were obtained through fraud, abuse, or violation of these Terms.',
      ],
    },
    {
      heading: '4. Your Content',
      blocks: [
        'You retain all ownership rights to the content you create or upload (“Your Content”). You grant Soleil a worldwide, non-exclusive, royalty-free license to host, store, reproduce, modify (for example, to create thumbnails or to format media for display), and distribute Your Content solely as needed to operate and provide the Service to you, to the collaborators you choose, and to the apps you connect. This includes processing it with the automated and AI features described in our Privacy Policy. If you agree to layout outlines, it also includes making plain outlines of how your clusters are laid out, to improve the Service, as our Privacy Policy describes; an outline holds none of Your Content’s words, pictures or files.',
        'Publishing. When you publish a cluster to Explore or share it with a public link, you also allow us to display it publicly, list it, let search engines index it (for Explore), make link previews and thumbnails of it, and let visitors view it and, where you allow, download its files. This lasts until you unpublish it or turn off the link, except for copies others already made.',
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
            'access the Service by automated means other than our API and MCP server, used within their limits;',
            'create accounts or invitations in bulk, or game referral or promotional rewards;',
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
        'The Service lets you invite collaborators and create public links. You are responsible for what you choose to share and with whom. Anyone with a public link may be able to view the shared content, so share carefully. A cluster published to Explore is public and can appear in search results.',
        'Each workspace has one owner, who can also add co-owners. The owner and co-owners decide who can view or edit, can remove people and turn off links, and can see everything in the workspace. Only the owner can delete the workspace or hand it to someone else; after a handover it runs on the new owner’s plan. Content added to a workspace stays with that workspace when the person who added it leaves or is removed.',
        'In a Team, the team owns its workspaces. The team’s owner and admins manage seats and members and can open every team workspace, including private ones. A Team does not see or control members’ own personal workspaces.',
        'We review clusters submitted to Explore and may decline or remove any of them.',
      ],
    },
    {
      heading: '7. Apps, the API and AI Assistants',
      blocks: [
        'You can connect AI assistants and other apps to your account through our API and MCP server. When you do:',
        {
          list: [
            'you choose what the app may do (read, write, and, only if you allow it, delete), and it acts on your behalf with your account’s access;',
            'you are responsible for what it does in your account, and for reviewing changes it makes;',
            'what it reads from Clusters is sent to the app and the company that runs it, under that company’s own terms and privacy policy, which we do not control;',
            'you can disconnect it at any time in Settings › Connections › Connected apps.',
          ],
        },
        'Use of the API and MCP server is subject to rate limits and to these Terms. Keep your API keys and tokens secret. We may limit, suspend or revoke a key, token or app that is misused, puts the Service or other users at risk, or breaks these Terms, and we may change or retire API features with reasonable notice where we can.',
      ],
    },
    {
      heading: '8. AI Features',
      blocks: [
        'The Service uses AI to suggest tags, describe pictures, and transcribe voice notes, as described in our Privacy Policy. AI output, including anything an assistant you connect writes into your account, can be wrong, incomplete or unsuitable. Review it before you rely on it or publish it. A workspace owner or co-owner can turn our AI features off in Settings › Workspace › AI suggestions.',
      ],
    },
    {
      heading: '9. Scout',
      blocks: [
        'Where Scout is offered, you can send pictures, links, notes and voice notes to Clusters by text message. By signing up you agree to receive messages about what you send, such as confirmations. Message and data rates may apply. Reply STOP at any time to stop. Your carrier, not us, is responsible for delivering messages, and we are not liable for delayed or undelivered messages.',
      ],
    },
    {
      heading: '10. Intellectual Property',
      blocks: [
        'The Service — including its software, design, and the Soleil and Clusters names and logos — is owned by Soleil and protected by intellectual-property laws. These Terms do not grant you any right to use our trademarks, logos, or branding.',
      ],
    },
    {
      heading: '11. Third-Party Services',
      blocks: [
        'The Service relies on third-party providers (such as Stripe, Supabase, and Cloudflare), can show content from other services (such as fonts, and YouTube, Vimeo, Spotify, TikTok, Instagram or X players), and can be used through AI assistants and apps run by other companies. We are not responsible for third-party services, and your use of them is subject to their own terms and policies.',
      ],
    },
    {
      heading: '12. Disclaimers',
      blocks: [
        'The Service is provided “as is” and “as available,” without warranties of any kind, whether express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, secure, or error-free, that AI output will be accurate, or that any content will be preserved without loss. You are responsible for keeping your own backups of important content.',
      ],
    },
    {
      heading: '13. Limitation of Liability',
      blocks: [
        'To the fullest extent permitted by law, Soleil and its affiliates will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of data, profits, or goodwill, arising out of or relating to your use of the Service. Our total liability for any claim relating to the Service will not exceed the greater of the amount you paid us in the twelve months before the claim or one hundred U.S. dollars ($100).',
      ],
    },
    {
      heading: '14. Indemnification',
      blocks: [
        'You agree to indemnify and hold harmless Soleil from claims, damages, losses, and expenses (including reasonable attorneys’ fees) arising out of Your Content, your use of the Service, or your violation of these Terms or the rights of others.',
      ],
    },
    {
      heading: '15. Termination',
      blocks: [
        'You may stop using the Service at any time, and you can delete your account yourself in Settings › Profile. Deleting your account is immediate and cannot be undone; our Privacy Policy explains what happens to your workspaces and content. We may suspend or terminate your access if you violate these Terms or if we reasonably believe it is necessary to protect the Service or other users. Upon termination, your right to use the Service ends. Provisions that by their nature should survive — such as content licenses for content you have already shared, disclaimers, limitations of liability, and indemnification — will survive.',
      ],
    },
    {
      heading: '16. Changes to These Terms',
      blocks: [
        'We may update these Terms from time to time. If we make material changes, we will update the “Last updated” date above and, where appropriate, provide additional notice. Your continued use of the Service after changes take effect means you accept the updated Terms.',
      ],
    },
    {
      heading: '17. Governing Law',
      blocks: [
        'These Terms are governed by the laws of the State of Georgia, U.S.A., without regard to its conflict-of-laws rules. You agree that the state and federal courts located in Georgia will have exclusive jurisdiction over any disputes arising out of or relating to these Terms or the Service.',
      ],
    },
    {
      heading: '18. Contact Us',
      blocks: [
        'Questions about these Terms? Email us at ' + CONTACT_EMAIL + '.',
      ],
    },
  ],
};

const cookies = {
  slug: 'cookies',
  title: 'Cookie Policy',
  updated: 'November 5, 2026',
  intro:
    'This Cookie Policy explains how Soleil Clusters uses cookies, local storage, and similar technologies (together, “cookies”) when you use the Service. For more on how we handle personal information, see our Privacy Policy.',
  sections: [
    {
      heading: '1. What Are Cookies?',
      blocks: [
        'Cookies are small data files stored on your device. “Local storage,” “session storage” and “IndexedDB” are related browser technologies that also store data on your device. The Service itself sets no cookies; it uses browser storage to keep you signed in, remember your preferences, keep your recent work at hand, and understand usage. Some of our partners set cookies, as described below.',
      ],
    },
    {
      heading: '2. Categories of Cookies We Use',
      blocks: [
        {
          list: [
            'Strictly necessary. Required for the Service to function — for example, keeping you securely signed in. Our authentication provider (Supabase) stores your session in your browser’s local storage, not in a cookie. Apps and AI assistants you connect use access tokens, not cookies. If we ask your browser to pass a bot check (Cloudflare Turnstile), it may set what it needs to tell people from bots. The Service will not work properly without these.',
            'Functional. Remember your choices and keep your work at hand — for example, feature preferences and recently used fonts, unsent drafts, and an invitation you opened before signing in. We also keep a copy of the clusters you opened most recently in your browser (IndexedDB), linked to your account, so they open quickly and stay available when your connection drops. It stays on your device.',
            'Analytics. Help us understand how the Service is used so we can improve it. Our analytics are our own: we keep a random identifier (soleil_session_id) in local storage to count visits and recognize a returning browser, an identifier for each open tab in session storage, and events waiting to be sent. We do not use third-party analytics cookies.',
            'Advertising and measurement. Help us measure and optimize our marketing. We use the Meta Pixel, which may set cookies such as _fbp and store an ad click identifier (_fbc) from ad links, and we send related events to Meta through the Meta Conversions API. The Meta Pixel is not loaded on a page opened from a private link, such as a shared cluster or an invitation. We also store the campaign parameters and ad-click identifiers from other advertising networks (such as Google, Microsoft, TikTok, Reddit, X, LinkedIn, Pinterest, and Snapchat) in your browser — the first ones of a visit in session storage and the most recent ones in local storage (soleil_last_source) — to attribute visits and measure our campaigns.',
          ],
        },
      ],
    },
    {
      heading: '3. Content From Other Services',
      blocks: [
        'Some parts of the Service load from other companies, which may set their own cookies or collect your IP address and browser details under their own policies:',
        {
          list: [
            'Fonts, from Adobe Fonts and Google Fonts.',
            'Video, audio and post players for YouTube, Vimeo, Spotify, TikTok, Instagram and X links in a cluster.',
            'Pictures, link previews and files that people link into a cluster, which load from the sites that host them.',
            'Stripe’s checkout and billing pages, when you pay or manage a subscription, which use cookies for payments and fraud prevention.',
          ],
        },
      ],
    },
    {
      heading: '4. How to Control Cookies',
      blocks: [
        'Browser settings. Most browsers let you block or delete cookies and clear local storage and other site data. Note that blocking strictly necessary storage may prevent you from signing in or using parts of the Service, and clearing site data removes the saved copy of your recent clusters from that browser.',
        'Advertising opt-outs. You can manage ad preferences in your Facebook and Instagram settings, and use industry opt-out tools — such as the Digital Advertising Alliance (optout.aboutads.info) or Your Online Choices (youronlinechoices.eu) — to limit interest-based advertising.',
        'Preference signals. We honor Global Privacy Control wherever you are. When your browser sends it, we do not load the Meta Pixel, so it sets no Meta cookies, and we do not send your activity to Meta through the Conversions API.',
      ],
    },
    {
      heading: '5. Changes to This Policy',
      blocks: [
        'We may update this Cookie Policy as our technologies or partners change. We will update the “Last updated” date above when we do.',
      ],
    },
    {
      heading: '6. Contact Us',
      blocks: [
        'Questions about our use of cookies? Email us at ' + CONTACT_EMAIL + '.',
      ],
    },
  ],
};

export const LEGAL_DOCS = { privacy, terms, cookies };
