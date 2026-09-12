# Sporta Rights, Security, and Abuse Boundary

## Rights/authorization

Every source entering a media session carries an explicit authorization policy. The policy may identify allowed operations such as analysis, transformation, live delivery, storage duration, derivative generation, and sharing. The system must fail closed when a required authorization decision is missing.

This document is an engineering control boundary, not legal advice and not a statement that any jurisdiction treats transformation as non-infringing.

## Media security

Treat media containers, codecs, metadata, subtitles, audio, and generated files as untrusted. Validate inputs, sandbox decoding, cap duration/size/resource use, and protect internal storage paths.

## Tenant isolation

Users may only access sessions, media, outputs, and telemetry they are authorized to access. Signed/short-lived delivery URLs are preferred. Do not leak source URLs into public client telemetry.

## Model safety

Model inputs may contain malicious or adversarial media/audio. Model outputs are untrusted. Prompts/instructions extracted from commentary or captions must never become privileged system instructions.

## Abuse controls

At minimum plan for:

- resource exhaustion through huge/hostile media;
- unauthorized copyrighted/broadcast content;
- impersonation or malicious style instructions;
- unsafe generated content through creator extensions;
- denial of service against GPU workers;
- data exfiltration through generated artifacts.

## Provider isolation

Secrets are never stored in repository files. Model/provider credentials are injected through runtime secret management.
