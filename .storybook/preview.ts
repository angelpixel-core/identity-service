import type { Preview } from '@storybook/react';
import '../interfaces/web/client/design-system/tokens.css';
import '../interfaces/web/client/styles.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;

