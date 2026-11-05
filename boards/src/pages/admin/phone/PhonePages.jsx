/* The pages behind the phone panel's Today tab. AdminPhonePanel lazy-loads this
   chunk and, while a page is open (?page=<id>; Back pops it), renders
   <PhonePage key={id} id={id} … /> in place of the home.

   Each page's calls are PAGE_CALLS[id] (phoneData.js), read here through
   usePhoneData: a page shows cached values at once, keeps its last values while
   it refreshes, and reuses a slow call for 30 minutes on automatic refreshes
   (refresh.force skips that). The page components below get the values and
   render them; every number they show comes from a pure model in src/lib
   (phoneInsights.js, phoneGrowthModels.js, phonePageModels.js), never from
   arithmetic in the JSX. */
import { PAGE_CALLS, usePhoneData } from './phoneData.js';
import { GrowthPage } from './PhoneGrowth.jsx';
import { SearchPage } from './PhoneSearch.jsx';
import { SourcesPage } from './PhoneSources.jsx';
import { MoneyPage } from './PhoneMoney.jsx';
import { SharingPage } from './PhoneSharing.jsx';
import { ProblemsPage } from './PhoneProblems.jsx';
import { EmailsPage } from './PhoneEmails.jsx';

const PAGES = {
  growth: GrowthPage,
  search: SearchPage,
  sources: SourcesPage,
  money: MoneyPage,
  sharing: SharingPage,
  problems: ProblemsPage,
  emails: EmailsPage,
};

export const PAGE_IDS = Object.keys(PAGES);

/**
 * @param {{
 *   id: string,                       // a PAGE_CALLS key
 *   refresh: {n:number, force:boolean},
 *   now: number,                      // the panel's clock (ms)
 *   onBack: () => void,               // "‹ Today"
 *   onSheet: (measureId: string) => void, // open a measure sheet over the page
 *   onRetry: () => void,              // fetch everything again (force)
 * }} props
 */
export function PhonePage({ id, refresh, now, onBack, onSheet, onRetry }) {
  const Page = PAGES[id];
  const { values, errors, loading } = usePhoneData(PAGE_CALLS[id] || [], refresh, { enabled: !!Page });
  if (!Page) return null;
  return (
    <Page
      data={values}
      errors={errors}
      loading={loading}
      now={now}
      onBack={onBack}
      onSheet={onSheet}
      onRetry={onRetry}
    />
  );
}

export default PhonePage;
