import { Sp500Browser } from './Sp500Browser';

export const metadata = {
  title: 'S&P 500 Concentration',
  description:
    'How top-heavy the S&P 500 is over time — top-N cap-weights, the Herfindahl index, and the effective number of constituents, point-in-time from 1998.',
};

export default function Sp500Page() {
  return <Sp500Browser />;
}
