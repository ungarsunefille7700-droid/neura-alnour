const SENSITIVE_ENVIRONMENT_NAME = (
  /(?:^|_)(?:api_?key|token|secret|password|passwd|credential|private_?key|access_?key|cookie)(?:$|_)/i
);

const PROVIDER_ENVIRONMENT_NAME = (
  /^(?:AWS|AZURE|GOOGLE|GITHUB|GH|GITLAB|NPM|OPENAI|ANTHROPIC|GEMINI|EMERGENT|STRIPE|PAYPAL|SENTRY|VERCEL|RENDER|CLOUDFLARE|DIGITALOCEAN|TWILIO|TAVILY|RESEND)_/i
);

const CONNECTION_ENVIRONMENT_NAME = (
  /^(?:MONGO|MONGODB|DATABASE|REDIS|POSTGRES|POSTGRESQL|MYSQL|MARIADB|ELASTIC|RABBITMQ)(?:_|$)/i
);

export const isSensitiveEnvironmentName = (name: string): boolean => (
  SENSITIVE_ENVIRONMENT_NAME.test(name)
  || PROVIDER_ENVIRONMENT_NAME.test(name)
  || CONNECTION_ENVIRONMENT_NAME.test(name)
  || [
    'DOCKER_AUTH_CONFIG',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'SSH_AUTH_SOCK',
    'SSH_AGENT_PID'
  ].includes(name.toUpperCase())
);

export const createSandboxedEnvironment = (
  source: NodeJS.ProcessEnv = process.env,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string' || isSensitiveEnvironmentName(name)) continue;
    environment[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (typeof value !== 'string' || isSensitiveEnvironmentName(name)) continue;
    environment[name] = value;
  }
  environment.NEURACO_SANDBOX = '1';
  return environment;
};
