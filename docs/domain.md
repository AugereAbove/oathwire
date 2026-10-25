# Frontend domain

The template supports an optional frontend hostname and an existing ACM certificate. Leaving both parameters empty preserves the generated CloudFront address. CloudFormation rejects a hostname without a certificate, or a certificate without a hostname.

For `oathwire.zadaks.com`, use the existing Cloudflare zone and CloudFront distribution. Request a standard public certificate with DNS validation and export disabled. CloudFront requires its ACM certificate in `us-east-1`; application resources remain in `eu-central-1`. Add only the validation CNAME returned by ACM and retain it for renewal.

After the certificate is issued, prepare a change set with:

- `FrontendDomain=oathwire.zadaks.com`
- `FrontendCertificateArn` set to that certificate's ARN
- `WebOrigin=https://oathwire.zadaks.com`
- All other parameter values preserved

The distribution uses SNI and TLS 1.2 or newer. Preserve private S3 access, OAC, response headers, caching, price class, concurrency and all other controls. Review the exact change set before executing it. No extra hosting, Route 53 zone, Private CA, exportable certificate or dedicated IP SSL is needed.

Rebuild the frontend with `VITE_REDIRECT_URI=https://oathwire.zadaks.com/callback` and the existing public API/Cognito identifiers. Publish a verified manifest, with assets before `index.html`. Add a DNS-only CNAME from `oathwire.zadaks.com` to the existing CloudFront hostname after the distribution update completes. Verify TLS, sign-in, callback, CORS and delivery before calling the domain connected. Keep the previous template, parameters and frontend manifest for rollback.

The scoped certificate policy draft is in `infra/policies/certificate-request.json`. Substitute the approved account ID locally. It allows only a tagged public, non-exportable DNS certificate for the exact hostname, plus its tagging and metadata reads. It cannot export or delete certificates, request a private certificate, modify billing or change IAM. Temporary planning, execution and publishing access requires a separate reviewed grant and must be removed after use.

AWS lists non-exportable public certificates for integrated services at no cost. Existing traffic, requests and storage remain usage billed. See [ACM pricing](https://aws.amazon.com/certificate-manager/pricing/) and [CloudFront certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

As of 2026-10-25, the non-exportable certificate is issued and its DNS validation CNAME is configured. The application domain update and frontend publication are prepared for change-set review; the custom hostname is not serving the application yet.

The certificate request requires AWS-managed keys. Its dependent tagging permission checks key origin when present, because AWS reads that value from an existing certificate and the value was absent during creation. The region, account, requested tag and allowed tag keys remain required. An existing conflicting stack tag is rejected. The first request was denied before creation; the corrected request succeeded without adding IAM actions.
