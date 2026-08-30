Skycord — Terms of Service Draft Outline

Status: Draft / Not legally reviewed
Applies to: skycord.xyz hosted service
Does not automatically apply to: Independently operated self-hosted Skycord instances

1. Acceptance of Terms

By creating an account or using skycord.xyz, the user agrees to these Terms of Service.

Use of the hosted service is permitted only for users who satisfy the service's minimum age requirement.

Hosted service age requirement

Initial policy:
Users must be 18 years of age or older to use skycord.xyz.

Skycord may modify this requirement in the future, subject to applicable law.

2. Self-Hosted Skycord

Skycord is open-source software and may be independently installed and operated by third parties.

A self-hosted Skycord instance is not automatically operated, controlled, or endorsed by the Skycord project or skycord.xyz.

The operator of an independently hosted instance is responsible for:

their server and infrastructure
their users
their content
moderation
privacy practices
applicable laws and regulations
their own Terms of Service, where appropriate

Use of self-hosted Skycord software is not subject to the age requirement imposed on skycord.xyz, although the operator and users remain responsible for complying with laws applicable to their circumstances.

Important distinction

Skycord software ≠ Skycord hosted service.

The Skycord project provides the software.
Individual operators provide and control their own instances.

3. Acceptable Use

Users may not use skycord.xyz to:

conduct unlawful activities
facilitate unlawful activities
promote unlawful activities
solicit or coordinate unlawful activities
knowingly assist unlawful activities or unlawful businesses
use the service as infrastructure for prohibited or illegal business operations

Users are responsible for activity conducted through their accounts.

Skycord may take action against accounts or content when required by these Terms or applicable law.

Wording to reconsider

Instead of banning merely “condoning illegal practices,” define prohibited conduct around facilitating, coordinating, promoting, soliciting, or knowingly assisting unlawful activity.

This avoids accidentally treating ordinary discussion or opinions as prohibited conduct.

4. User Responsibility

Users are responsible for:

information they submit
content they send or publish
activity performed through their account
maintaining control of their account and authentication methods
complying with applicable laws

Users must not intentionally circumvent security controls, authentication mechanisms, rate limits, or other technical protections.

5. Privacy and Data Protection

Skycord aims to minimize the data it needs to operate the service.

The hosted service's Privacy Policy describes:

what information is collected
what information is stored
how long information is retained
how information is used
what information may be disclosed
applicable user rights

Privacy and encryption claims must describe the actual implementation of the version being operated, rather than planned functionality.

6. End-to-End Encryption

Where encrypted conversations are supported:

Messages are encrypted on the sender's device before being transmitted.

The server does not possess the keys required to decrypt the contents of properly implemented encrypted conversations.

However, encryption does not mean that the server necessarily knows nothing about the communication.

Depending on the mode and implementation, the service may still process metadata such as:

participating accounts
connection information
timestamps
delivery state
other operational metadata required to provide the service
Normal encrypted conversations

Encrypted messages may be temporarily stored as ciphertext for delivery and deleted according to the service's retention policy.

Stealth sessions

Stealth sessions are designed to be ephemeral and are not persisted as normal conversation history.

Skycord does not claim that Stealth Mode prevents:

screenshots
photography of a screen
recording by another device
compromise of a user's endpoint
7. Security

Skycord attempts to maintain reasonable security measures for the hosted service.

However, no software or communication service can guarantee absolute security.

Users are responsible for securing their own devices and authentication credentials.

Security features may differ between:

skycord.xyz
self-hosted instances
different versions of Skycord
different server configurations
8. Self-Hosted Instance Responsibility

The Skycord project does not control independently operated instances.

An operator who deploys Skycord is responsible for deciding:

who may access the instance
whether registration is enabled
what content is permitted
how data is retained
how the server is secured
whether encryption features are enabled
what logging is performed
what legal obligations apply to their deployment

Skycord's documentation may provide recommended security practices, but following those recommendations does not transfer legal or operational responsibility from the operator to the Skycord project.

9. Government and Legal Requests

Skycord does not promise to ignore lawful requests from governments, courts, or other competent authorities.

Where the law applicable to the service requires a response, Skycord may comply to the extent legally required.

Skycord also cannot provide information that it does not possess or technically have access to.

For example, if properly implemented E2EE means the hosted server possesses only ciphertext and not the corresponding decryption key, the server cannot provide plaintext that it does not have.

This section should be written very carefully after deciding where the hosted service is legally operated.

10. Content and Moderation

Skycord may establish rules concerning prohibited content and activity.

For the hosted service, Skycord may:

remove or restrict content
suspend accounts
terminate accounts
restrict access to features
take other reasonable measures

when permitted or required by these Terms or applicable law.

Self-hosted operators make their own moderation decisions for their own instances.

11. Account Suspension and Termination

Skycord may suspend or terminate hosted accounts for reasons including:

violation of these Terms
unlawful activity
attempts to compromise the service
abuse of infrastructure
fraud
security threats
legal requirements

The exact rules for termination, appeals, and data deletion should be defined here later.

12. Availability

Skycord is provided on an availability basis and may experience:

outages
maintenance
service interruptions
software bugs
infrastructure failures
network failures

No guarantee of uninterrupted availability should be made unless you actually intend to provide one.

13. Open-Source Software

Skycord software is distributed under its applicable open-source license, currently AGPL-3.0.

The open-source license governs use, modification, and distribution of the software.

These Terms govern use of Skycord-operated hosted services.

The two documents serve different purposes and should not be treated as replacements for one another.

14. Third-Party Services

Skycord may depend on or integrate with third-party services or infrastructure.

Examples may include:

hosting providers
DNS/CDN providers
email providers
voice infrastructure
authentication or platform services
external APIs

The final Terms should identify which third parties actually process user information and reference the Privacy Policy where appropriate.

15. Changes to the Service

Skycord may:

add features
remove features
modify functionality
change security mechanisms
change infrastructure
release new versions

Security-sensitive changes may alter what information is processed or stored, and the Privacy Policy should be updated where necessary.

16. Changes to These Terms

Skycord may update these Terms.

The final document should specify:

how changes are announced
when changes become effective
whether continued use constitutes acceptance
what happens if a user rejects a material change
17. Limitation of Liability

Leave this section for legal review rather than trying to make it maximally broad yourself.

The goal should be to establish reasonable limitations for:

outages
data loss
third-party infrastructure
user-generated content
independently operated instances
self-hosted deployments

but without pretending mandatory legal protections don't exist.

18. Governing Law and Jurisdiction

Leave this as a deliberate decision rather than filling it in automatically.

This should identify the law and jurisdiction you intend to use for disputes involving skycord.xyz, subject to mandatory law that cannot legally be excluded.

This section should be drafted with your actual operating entity/location in mind.

19. Contact

Provide a real contact method for matters such as:

legal requests
abuse reports
security reports
account issues
privacy requests



Other stuff 
Very important: separate these documents

I'd make the project structure something like:

/legal
    TERMS.md
    PRIVACY.md
    SELF_HOSTING.md
    LICENSE.md

And on the website:

Terms
Privacy
Self-hosting
Open Source / License
Security

Your AGPL stays about the software.
Your TOS governs skycord.xyz.
Your Privacy Policy explains your data practices.
Your self-hosting policy/documentation establishes the boundary between your project and independent operators.

One thing I'd lock down before drafting the final legal text is whether “18+” is an absolute Skycord-hosted-service rule, because that's much cleaner than trying to determine a user's local contractual age country by country.