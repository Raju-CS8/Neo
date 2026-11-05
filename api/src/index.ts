import { buildServer } from './app';
import { env } from './env';

buildServer().server.listen(env.PORT, () => console.log(`API on http://localhost:${env.PORT}`));
