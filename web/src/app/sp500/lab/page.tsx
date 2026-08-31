import { LabBrowser } from './LabBrowser';

export const metadata = {
  title: 'S&P 500 Index Lab',
  description:
    'Counterfactual S&P 500: remove any companies or sectors and re-run index history on the survivors — how much of the return was just the Mag-7? what does the market look like ex-Energy?',
};

export default function LabPage() {
  return <LabBrowser />;
}
