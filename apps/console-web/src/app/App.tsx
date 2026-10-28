import { AuthGate } from './AuthGate.js';
import { ConsolePage } from '../features/console/ConsolePage.js';

export function App(): React.JSX.Element {
  return (
    <AuthGate>
      <ConsolePage />
    </AuthGate>
  );
}
