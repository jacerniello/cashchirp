--
-- PostgreSQL database dump
--

\restrict RWav7hVzZmbWLkWVKFPZRaIZqEghELfuj46e0s74qYBF2a349115JcyYXu9ei7Q

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: derived; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA derived;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: insider; Type: TABLE; Schema: derived; Owner: -
--

CREATE TABLE derived.insider (
    owner_id text,
    ownername text,
    txns bigint,
    companies bigint,
    first_trade date,
    last_trade date,
    ever_director boolean,
    ever_officer boolean,
    ever_tenpct boolean,
    asof date
);


--
-- Name: insider_company; Type: TABLE; Schema: derived; Owner: -
--

CREATE TABLE derived.insider_company (
    owner_id text,
    ownername text,
    permaticker bigint,
    ticker text,
    issuername text,
    txns bigint,
    acquired_value double precision,
    disposed_value double precision,
    net_value double precision,
    acquired_shares double precision,
    disposed_shares double precision,
    om_buy_value double precision,
    om_sell_value double precision,
    om_net_value double precision,
    om_buy_shares double precision,
    om_sell_shares double precision,
    om_txns bigint,
    first_trade date,
    last_trade date,
    latest_shares double precision,
    asof date
);


--
-- Name: actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.actions (
    id bigint NOT NULL,
    date date,
    action text,
    ticker text,
    name text,
    value double precision,
    contraticker text,
    contraname text,
    permaticker bigint
);


--
-- Name: actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.actions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.actions_id_seq OWNED BY public.actions.id;


--
-- Name: daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily (
    id bigint NOT NULL,
    ticker text,
    date date,
    lastupdated date,
    ev double precision,
    evebit double precision,
    evebitda double precision,
    marketcap double precision,
    pb double precision,
    pe double precision,
    ps double precision,
    permaticker bigint
);


--
-- Name: daily_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_id_seq OWNED BY public.daily.id;


--
-- Name: event_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_codes (
    code character varying(8) NOT NULL,
    title text,
    description text
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    ticker text,
    date date,
    eventcodes text,
    permaticker bigint
);


--
-- Name: events_decoded; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.events_decoded AS
 SELECT e.ticker,
    e.date,
    e.eventcodes,
    array_agg(ec.title ORDER BY c.ord) AS event_titles
   FROM ((public.events e
     LEFT JOIN LATERAL unnest(string_to_array(e.eventcodes, '|'::text)) WITH ORDINALITY c(code, ord) ON (true))
     LEFT JOIN public.event_codes ec ON (((ec.code)::text = c.code)))
  GROUP BY e.ticker, e.date, e.eventcodes;


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: finra_short_interest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finra_short_interest (
    id integer NOT NULL,
    symbol character varying(16) NOT NULL,
    issue_name text,
    settlementdate date NOT NULL,
    market character varying(8),
    current_short bigint,
    previous_short bigint,
    change_short bigint,
    change_pct double precision,
    avg_daily_vol bigint,
    days_to_cover double precision,
    accounting_ym integer,
    stock_split_flag character varying(8),
    revision_flag character varying(8),
    issuer_exchange character varying(8)
);


--
-- Name: finra_short_interest_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finra_short_interest_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finra_short_interest_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finra_short_interest_id_seq OWNED BY public.finra_short_interest.id;


--
-- Name: tickers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickers (
    id bigint NOT NULL,
    "table" text,
    permaticker text,
    ticker text,
    name text,
    exchange text,
    isdelisted text,
    category text,
    cusips text,
    siccode text,
    sicsector text,
    sicindustry text,
    figi text,
    famaindustry text,
    sector text,
    industry text,
    scalemarketcap text,
    scalerevenue text,
    relatedtickers text,
    currency text,
    location text,
    lastupdated date,
    firstadded date,
    firstpricedate date,
    lastpricedate date,
    firstquarter date,
    lastquarter date,
    secfilings text,
    companysite text
);


--
-- Name: finra_short_interest_resolved; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.finra_short_interest_resolved AS
 SELECT si.id,
    si.symbol,
    si.issue_name,
    si.settlementdate,
    si.market,
    si.current_short,
    si.previous_short,
    si.change_short,
    si.change_pct,
    si.avg_daily_vol,
    si.days_to_cover,
    si.accounting_ym,
    si.stock_split_flag,
    si.revision_flag,
    si.issuer_exchange,
    r.permaticker
   FROM (public.finra_short_interest si
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (count(DISTINCT t.permaticker) = 1) THEN min((t.permaticker)::bigint)
                    ELSE NULL::bigint
                END AS permaticker
           FROM public.tickers t
          WHERE ((t.ticker = (si.symbol)::text) AND (si.settlementdate >= t.firstpricedate) AND (si.settlementdate <= COALESCE(t.lastpricedate, CURRENT_DATE)))) r ON (true));


--
-- Name: fred_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fred_files (
    path character varying(255) NOT NULL,
    dataset character varying(16),
    kind character varying(16),
    vintage character varying(16),
    source_url text,
    sha256 character varying(64),
    n_bytes bigint,
    requested_at timestamp with time zone,
    content_updated_at timestamp with time zone
);


--
-- Name: fred_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fred_observations (
    id integer NOT NULL,
    series_id character varying(64) NOT NULL,
    date date NOT NULL,
    value double precision,
    vintage character varying(16) NOT NULL
);


--
-- Name: fred_observations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fred_observations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fred_observations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fred_observations_id_seq OWNED BY public.fred_observations.id;


--
-- Name: fred_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fred_series (
    series_id character varying(64) NOT NULL,
    dataset character varying(16),
    tcode integer,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    fred_code character varying(64)
);


--
-- Name: holder_timeseries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holder_timeseries (
    permaticker bigint,
    investorname text,
    rank bigint,
    calendardate date,
    value double precision,
    units double precision,
    adj_units double precision,
    price text,
    asof date
);


--
-- Name: institutional_holdings_timeseries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.institutional_holdings_timeseries (
    investorname text,
    permaticker bigint,
    ticker text,
    rank bigint,
    calendardate date,
    value double precision,
    units double precision,
    adj_units double precision,
    price text,
    asof date
);


--
-- Name: load_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.load_log (
    id integer NOT NULL,
    source character varying(32) NOT NULL,
    dataset character varying(64) NOT NULL,
    operation character varying(32) NOT NULL,
    status character varying(16) NOT NULL,
    rows bigint,
    requested_at timestamp with time zone,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    detail text
);


--
-- Name: load_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.load_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: load_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.load_log_id_seq OWNED BY public.load_log.id;


--
-- Name: metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metrics (
    id bigint NOT NULL,
    ticker text,
    date date,
    lastupdated date,
    beta1y double precision,
    beta5y double precision,
    dividendyieldforward double precision,
    dividendyieldtrailing double precision,
    high52w double precision,
    high5y double precision,
    low52w double precision,
    low5y double precision,
    ma200d double precision,
    ma200w double precision,
    ma50d double precision,
    ma50w double precision,
    price double precision,
    return1y double precision,
    return5y double precision,
    returnytd double precision,
    volume double precision,
    volumeavg1m double precision,
    volumeavg3m double precision,
    permaticker bigint
);


--
-- Name: metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.metrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.metrics_id_seq OWNED BY public.metrics.id;


--
-- Name: permaticker_lookup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permaticker_lookup (
    product text,
    ticker text,
    permaticker bigint
);


--
-- Name: report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report (
    id bigint NOT NULL,
    name text NOT NULL,
    tool text NOT NULL,
    spec jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: report_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_id_seq OWNED BY public.report.id;


--
-- Name: screener_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.screener_snapshot (
    permaticker bigint,
    ticker text,
    name text,
    sector text,
    industry text,
    exchange text,
    scalemarketcap text,
    isdelisted text,
    firstpricedate date,
    marketcap double precision,
    ev double precision,
    pe double precision,
    ps double precision,
    pb double precision,
    ev_ebitda double precision,
    revenue double precision,
    cashneq double precision,
    debt double precision,
    fcf double precision,
    opinc double precision,
    assets double precision,
    liabilities double precision,
    workingcapital double precision,
    retearn double precision,
    ebit double precision,
    gross_margin double precision,
    net_margin double precision,
    roe double precision,
    roa double precision,
    roic double precision,
    current_ratio double precision,
    debt_equity double precision,
    debtnc double precision,
    equity double precision,
    assetsc double precision,
    inventory double precision,
    liabilitiesc double precision,
    payout double precision,
    div_yield double precision,
    eps double precision,
    dps double precision,
    eps_1y double precision,
    revenue_1y double precision,
    eps_q double precision,
    eps_q1y double precision,
    rev_q double precision,
    rev_q1y double precision,
    eps_y double precision,
    eps_y1 double precision,
    eps_y3 double precision,
    eps_y5 double precision,
    rev_y double precision,
    rev_y1 double precision,
    rev_y3 double precision,
    rev_y5 double precision,
    dps_y double precision,
    dps_y3 double precision,
    shares_y double precision,
    shares_y5 double precision,
    inst_holders double precision,
    m_price double precision,
    high52w double precision,
    low52w double precision,
    p_cash double precision,
    p_fcf double precision,
    ev_sales double precision,
    oper_margin double precision,
    quick_ratio double precision,
    ltde double precision,
    net_cash double precision,
    net_cash_pct double precision,
    altman_z double precision,
    pct_above_low double precision,
    pct_below_high double precision,
    years_public double precision,
    shares_cagr_5y double precision,
    eps_g_ttm double precision,
    sales_g_ttm double precision,
    eps_g_qoq double precision,
    sales_g_qoq double precision,
    eps_g_yr double precision,
    sales_g_yr double precision,
    eps_g_3y double precision,
    eps_g_5y double precision,
    sales_g_3y double precision,
    sales_g_5y double precision,
    div_growth double precision,
    asof date
);


--
-- Name: sec_fund_class; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sec_fund_class (
    cik bigint,
    series_id text,
    class_id text,
    symbol text
);


--
-- Name: sep; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sep (
    id bigint NOT NULL,
    ticker text,
    date date,
    open double precision,
    high double precision,
    low double precision,
    close double precision,
    volume double precision,
    closeadj double precision,
    closeunadj double precision,
    lastupdated date,
    permaticker bigint
);


--
-- Name: sep_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sep_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sep_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sep_id_seq OWNED BY public.sep.id;


--
-- Name: sf1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sf1 (
    id bigint NOT NULL,
    ticker text,
    dimension text,
    calendardate date,
    datekey date,
    reportperiod date,
    fiscalperiod text,
    lastupdated date,
    accoci double precision,
    assets double precision,
    assetsavg double precision,
    assetsc double precision,
    assetsnc double precision,
    assetturnover double precision,
    bvps double precision,
    capex double precision,
    cashneq double precision,
    cashnequsd double precision,
    cor double precision,
    consolinc double precision,
    currentratio double precision,
    de double precision,
    debt double precision,
    debtc double precision,
    debtnc double precision,
    debtusd double precision,
    deferredrev double precision,
    depamor double precision,
    deposits double precision,
    divyield double precision,
    dps double precision,
    ebit double precision,
    ebitda double precision,
    ebitdamargin double precision,
    ebitdausd double precision,
    ebitusd double precision,
    ebt double precision,
    eps double precision,
    epsdil double precision,
    epsusd double precision,
    equity double precision,
    equityavg double precision,
    equityusd double precision,
    ev double precision,
    evebit double precision,
    evebitda double precision,
    fcf double precision,
    fcfps double precision,
    fxusd double precision,
    gp double precision,
    grossmargin double precision,
    intangibles double precision,
    intexp double precision,
    invcap double precision,
    invcapavg double precision,
    inventory double precision,
    investments double precision,
    investmentsc double precision,
    investmentsnc double precision,
    liabilities double precision,
    liabilitiesc double precision,
    liabilitiesnc double precision,
    marketcap double precision,
    ncf double precision,
    ncfbus double precision,
    ncfcommon double precision,
    ncfdebt double precision,
    ncfdiv double precision,
    ncff double precision,
    ncfi double precision,
    ncfinv double precision,
    ncfo double precision,
    ncfx double precision,
    netinc double precision,
    netinccmn double precision,
    netinccmnusd double precision,
    netincdis double precision,
    netincnci double precision,
    netmargin double precision,
    opex double precision,
    opinc double precision,
    payables double precision,
    payoutratio double precision,
    pb double precision,
    pe double precision,
    pe1 double precision,
    ppnenet double precision,
    prefdivis double precision,
    price double precision,
    ps double precision,
    ps1 double precision,
    receivables double precision,
    retearn double precision,
    revenue double precision,
    revenueusd double precision,
    rnd double precision,
    roa double precision,
    roe double precision,
    roic double precision,
    ros double precision,
    sbcomp double precision,
    sgna double precision,
    sharefactor double precision,
    sharesbas double precision,
    shareswa double precision,
    shareswadil double precision,
    sps double precision,
    tangibles double precision,
    taxassets double precision,
    taxexp double precision,
    taxliabilities double precision,
    tbvps double precision,
    workingcapital double precision,
    permaticker bigint
);


--
-- Name: sf1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sf1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sf1_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sf1_id_seq OWNED BY public.sf1.id;


--
-- Name: sf2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sf2 (
    id bigint NOT NULL,
    ticker text,
    filingdate date,
    formtype text,
    issuername text,
    ownername text,
    officertitle text,
    isdirector text,
    isofficer text,
    istenpercentowner text,
    transactiondate date,
    securityadcode text,
    transactioncode text,
    sharesownedbeforetransaction double precision,
    transactionshares double precision,
    sharesownedfollowingtransaction double precision,
    transactionpricepershare double precision,
    transactionvalue double precision,
    securitytitle text,
    directorindirect text,
    natureofownership text,
    dateexercisable date,
    priceexercisable double precision,
    expirationdate date,
    rownum double precision,
    permaticker bigint
);


--
-- Name: sf2_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sf2_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sf2_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sf2_id_seq OWNED BY public.sf2.id;


--
-- Name: sf3; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sf3 (
    id bigint NOT NULL,
    ticker text,
    investorname text,
    securitytype text,
    calendardate date,
    value double precision,
    units double precision,
    price text,
    permaticker bigint
);


--
-- Name: sf3_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sf3_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sf3_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sf3_id_seq OWNED BY public.sf3.id;


--
-- Name: sf3a; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sf3a (
    id bigint NOT NULL,
    calendardate date,
    ticker text,
    name text,
    shrholders double precision,
    cllholders double precision,
    putholders double precision,
    wntholders double precision,
    dbtholders double precision,
    prfholders double precision,
    fndholders double precision,
    undholders double precision,
    shrunits double precision,
    cllunits double precision,
    putunits double precision,
    wntunits double precision,
    dbtunits double precision,
    prfunits double precision,
    fndunits double precision,
    undunits double precision,
    shrvalue double precision,
    cllvalue double precision,
    putvalue double precision,
    wntvalue double precision,
    dbtvalue double precision,
    prfvalue double precision,
    fndvalue double precision,
    undvalue double precision,
    totalvalue double precision,
    percentoftotal double precision,
    permaticker bigint
);


--
-- Name: sf3a_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sf3a_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sf3a_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sf3a_id_seq OWNED BY public.sf3a.id;


--
-- Name: sf3b; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sf3b (
    id bigint NOT NULL,
    calendardate date,
    investorname text,
    shrholdings double precision,
    cllholdings double precision,
    putholdings double precision,
    wntholdings double precision,
    dbtholdings double precision,
    prfholdings double precision,
    fndholdings double precision,
    undholdings double precision,
    shrunits double precision,
    cllunits double precision,
    putunits double precision,
    wntunits double precision,
    dbtunits double precision,
    prfunits double precision,
    fndunits double precision,
    undunits double precision,
    shrvalue double precision,
    cllvalue double precision,
    putvalue double precision,
    wntvalue double precision,
    dbtvalue double precision,
    prfvalue double precision,
    fndvalue double precision,
    undvalue double precision,
    totalvalue double precision,
    percentoftotal double precision
);


--
-- Name: sf3b_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sf3b_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sf3b_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sf3b_id_seq OWNED BY public.sf3b.id;


--
-- Name: sfp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sfp (
    id bigint NOT NULL,
    ticker text,
    date date,
    open double precision,
    high double precision,
    low double precision,
    close double precision,
    volume double precision,
    closeadj double precision,
    closeunadj double precision,
    lastupdated date,
    permaticker bigint
);


--
-- Name: sfp_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sfp_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sfp_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sfp_id_seq OWNED BY public.sfp.id;


--
-- Name: sp500; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sp500 (
    id bigint NOT NULL,
    date date,
    action text,
    ticker text,
    name text,
    contraticker text,
    contraname text,
    note text,
    permaticker bigint
);


--
-- Name: sp500_concentration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sp500_concentration (
    date date,
    n_constituents bigint,
    total_mktcap double precision,
    hhi double precision,
    effective_n double precision,
    top1_ticker text,
    top1_name text,
    top1_weight double precision,
    top3_weight double precision,
    top5_weight double precision,
    top10_weight double precision,
    top25_weight double precision,
    top50_weight double precision,
    asof date
);


--
-- Name: sp500_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sp500_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sp500_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sp500_id_seq OWNED BY public.sp500.id;


--
-- Name: sp500_sector_weights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sp500_sector_weights (
    date date,
    sector text,
    weight double precision,
    n bigint,
    mktcap double precision,
    asof date
);


--
-- Name: sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_state (
    table_name character varying(64) NOT NULL,
    last_updated_date date,
    last_run timestamp with time zone,
    rows_loaded bigint
);


--
-- Name: tickers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tickers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tickers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tickers_id_seq OWNED BY public.tickers.id;


--
-- Name: actions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions ALTER COLUMN id SET DEFAULT nextval('public.actions_id_seq'::regclass);


--
-- Name: daily id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily ALTER COLUMN id SET DEFAULT nextval('public.daily_id_seq'::regclass);


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Name: finra_short_interest id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finra_short_interest ALTER COLUMN id SET DEFAULT nextval('public.finra_short_interest_id_seq'::regclass);


--
-- Name: fred_observations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fred_observations ALTER COLUMN id SET DEFAULT nextval('public.fred_observations_id_seq'::regclass);


--
-- Name: load_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.load_log ALTER COLUMN id SET DEFAULT nextval('public.load_log_id_seq'::regclass);


--
-- Name: metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics ALTER COLUMN id SET DEFAULT nextval('public.metrics_id_seq'::regclass);


--
-- Name: report id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report ALTER COLUMN id SET DEFAULT nextval('public.report_id_seq'::regclass);


--
-- Name: sep id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sep ALTER COLUMN id SET DEFAULT nextval('public.sep_id_seq'::regclass);


--
-- Name: sf1 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf1 ALTER COLUMN id SET DEFAULT nextval('public.sf1_id_seq'::regclass);


--
-- Name: sf2 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf2 ALTER COLUMN id SET DEFAULT nextval('public.sf2_id_seq'::regclass);


--
-- Name: sf3 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf3 ALTER COLUMN id SET DEFAULT nextval('public.sf3_id_seq'::regclass);


--
-- Name: sf3a id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf3a ALTER COLUMN id SET DEFAULT nextval('public.sf3a_id_seq'::regclass);


--
-- Name: sf3b id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf3b ALTER COLUMN id SET DEFAULT nextval('public.sf3b_id_seq'::regclass);


--
-- Name: sfp id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfp ALTER COLUMN id SET DEFAULT nextval('public.sfp_id_seq'::regclass);


--
-- Name: sp500 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sp500 ALTER COLUMN id SET DEFAULT nextval('public.sp500_id_seq'::regclass);


--
-- Name: tickers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickers ALTER COLUMN id SET DEFAULT nextval('public.tickers_id_seq'::regclass);


--
-- Name: actions actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_pkey PRIMARY KEY (id);


--
-- Name: daily daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily
    ADD CONSTRAINT daily_pkey PRIMARY KEY (id);


--
-- Name: event_codes event_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_codes
    ADD CONSTRAINT event_codes_pkey PRIMARY KEY (code);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: finra_short_interest finra_short_interest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finra_short_interest
    ADD CONSTRAINT finra_short_interest_pkey PRIMARY KEY (id);


--
-- Name: fred_files fred_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fred_files
    ADD CONSTRAINT fred_files_pkey PRIMARY KEY (path);


--
-- Name: fred_observations fred_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fred_observations
    ADD CONSTRAINT fred_observations_pkey PRIMARY KEY (id);


--
-- Name: fred_series fred_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fred_series
    ADD CONSTRAINT fred_series_pkey PRIMARY KEY (series_id);


--
-- Name: load_log load_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.load_log
    ADD CONSTRAINT load_log_pkey PRIMARY KEY (id);


--
-- Name: metrics metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics
    ADD CONSTRAINT metrics_pkey PRIMARY KEY (id);


--
-- Name: report report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_pkey PRIMARY KEY (id);


--
-- Name: sep sep_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sep
    ADD CONSTRAINT sep_pkey PRIMARY KEY (id);


--
-- Name: sf1 sf1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf1
    ADD CONSTRAINT sf1_pkey PRIMARY KEY (id);


--
-- Name: sf2 sf2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf2
    ADD CONSTRAINT sf2_pkey PRIMARY KEY (id);


--
-- Name: sf3 sf3_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf3
    ADD CONSTRAINT sf3_pkey PRIMARY KEY (id);


--
-- Name: sf3a sf3a_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf3a
    ADD CONSTRAINT sf3a_pkey PRIMARY KEY (id);


--
-- Name: sf3b sf3b_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf3b
    ADD CONSTRAINT sf3b_pkey PRIMARY KEY (id);


--
-- Name: sfp sfp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfp
    ADD CONSTRAINT sfp_pkey PRIMARY KEY (id);


--
-- Name: sp500 sp500_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sp500
    ADD CONSTRAINT sp500_pkey PRIMARY KEY (id);


--
-- Name: sync_state sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_state
    ADD CONSTRAINT sync_state_pkey PRIMARY KEY (table_name);


--
-- Name: tickers tickers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickers
    ADD CONSTRAINT tickers_pkey PRIMARY KEY (id);


--
-- Name: actions uq_actions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT uq_actions UNIQUE (ticker, name, date, contraticker, contraname, action);


--
-- Name: daily uq_daily; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily
    ADD CONSTRAINT uq_daily UNIQUE (ticker, date);


--
-- Name: events uq_events; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT uq_events UNIQUE (ticker, date);


--
-- Name: finra_short_interest uq_finra_si_symbol_date_market; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finra_short_interest
    ADD CONSTRAINT uq_finra_si_symbol_date_market UNIQUE (symbol, settlementdate, market);


--
-- Name: fred_observations uq_fred_obs_series_date_vintage; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fred_observations
    ADD CONSTRAINT uq_fred_obs_series_date_vintage UNIQUE (series_id, date, vintage);


--
-- Name: metrics uq_metrics; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics
    ADD CONSTRAINT uq_metrics UNIQUE (ticker, date);


--
-- Name: sep uq_sep; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sep
    ADD CONSTRAINT uq_sep UNIQUE (ticker, date);


--
-- Name: sf1 uq_sf1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf1
    ADD CONSTRAINT uq_sf1 UNIQUE (ticker, reportperiod, dimension, datekey);


--
-- Name: sf2 uq_sf2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf2
    ADD CONSTRAINT uq_sf2 UNIQUE (ticker, rownum, ownername, formtype, filingdate);


--
-- Name: sf3 uq_sf3; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf3
    ADD CONSTRAINT uq_sf3 UNIQUE (ticker, securitytype, investorname, calendardate);


--
-- Name: sf3a uq_sf3a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf3a
    ADD CONSTRAINT uq_sf3a UNIQUE (ticker, calendardate);


--
-- Name: sf3b uq_sf3b; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sf3b
    ADD CONSTRAINT uq_sf3b UNIQUE (investorname, calendardate);


--
-- Name: sfp uq_sfp; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfp
    ADD CONSTRAINT uq_sfp UNIQUE (ticker, date);


--
-- Name: sp500 uq_sp500; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sp500
    ADD CONSTRAINT uq_sp500 UNIQUE (ticker, date, action);


--
-- Name: tickers uq_tickers; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickers
    ADD CONSTRAINT uq_tickers UNIQUE (ticker, "table", permaticker);


--
-- Name: ix_insider_co_owner; Type: INDEX; Schema: derived; Owner: -
--

CREATE INDEX ix_insider_co_owner ON derived.insider_company USING btree (owner_id);


--
-- Name: ix_insider_co_permaticker; Type: INDEX; Schema: derived; Owner: -
--

CREATE INDEX ix_insider_co_permaticker ON derived.insider_company USING btree (permaticker);


--
-- Name: ix_insider_name; Type: INDEX; Schema: derived; Owner: -
--

CREATE INDEX ix_insider_name ON derived.insider USING btree (ownername);


--
-- Name: ix_insider_owner_id; Type: INDEX; Schema: derived; Owner: -
--

CREATE UNIQUE INDEX ix_insider_owner_id ON derived.insider USING btree (owner_id);


--
-- Name: ix_actions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_actions_date ON public.actions USING btree (date);


--
-- Name: ix_actions_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_actions_permaticker ON public.actions USING btree (permaticker);


--
-- Name: ix_daily_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_daily_date ON public.daily USING btree (date);


--
-- Name: ix_daily_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_daily_permaticker ON public.daily USING btree (permaticker);


--
-- Name: ix_events_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_events_date ON public.events USING btree (date);


--
-- Name: ix_events_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_events_permaticker ON public.events USING btree (permaticker);


--
-- Name: ix_finra_short_interest_settlementdate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_finra_short_interest_settlementdate ON public.finra_short_interest USING btree (settlementdate);


--
-- Name: ix_finra_short_interest_symbol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_finra_short_interest_symbol ON public.finra_short_interest USING btree (symbol);


--
-- Name: ix_fred_observations_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fred_observations_date ON public.fred_observations USING btree (date);


--
-- Name: ix_fred_observations_series_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fred_observations_series_id ON public.fred_observations USING btree (series_id);


--
-- Name: ix_holder_timeseries_permaticker_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_holder_timeseries_permaticker_rank ON public.holder_timeseries USING btree (permaticker, rank);


--
-- Name: ix_institutional_holdings_timeseries_investorname_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_institutional_holdings_timeseries_investorname_rank ON public.institutional_holdings_timeseries USING btree (investorname, rank);


--
-- Name: ix_load_log_dataset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_load_log_dataset ON public.load_log USING btree (dataset);


--
-- Name: ix_metrics_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_metrics_date ON public.metrics USING btree (date);


--
-- Name: ix_metrics_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_metrics_permaticker ON public.metrics USING btree (permaticker);


--
-- Name: ix_report_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_report_tool ON public.report USING btree (tool);


--
-- Name: ix_screener_snapshot_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_screener_snapshot_permaticker ON public.screener_snapshot USING btree (permaticker);


--
-- Name: ix_sec_fund_class_cik; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sec_fund_class_cik ON public.sec_fund_class USING btree (cik);


--
-- Name: ix_sec_fund_class_symbol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sec_fund_class_symbol ON public.sec_fund_class USING btree (upper(symbol));


--
-- Name: ix_sep_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sep_date ON public.sep USING btree (date);


--
-- Name: ix_sep_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sep_permaticker ON public.sep USING btree (permaticker);


--
-- Name: ix_sep_permaticker_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sep_permaticker_date ON public.sep USING btree (permaticker, date);


--
-- Name: ix_sf1_perma_dim_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sf1_perma_dim_date ON public.sf1 USING btree (permaticker, dimension, calendardate DESC);


--
-- Name: ix_sf1_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sf1_permaticker ON public.sf1 USING btree (permaticker);


--
-- Name: ix_sf2_ownername; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sf2_ownername ON public.sf2 USING btree (ownername);


--
-- Name: ix_sf2_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sf2_permaticker ON public.sf2 USING btree (permaticker);


--
-- Name: ix_sf3_investorname_calendardate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sf3_investorname_calendardate ON public.sf3 USING btree (investorname, calendardate);


--
-- Name: ix_sf3_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sf3_permaticker ON public.sf3 USING btree (permaticker);


--
-- Name: ix_sf3a_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sf3a_permaticker ON public.sf3a USING btree (permaticker);


--
-- Name: ix_sfp_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sfp_date ON public.sfp USING btree (date);


--
-- Name: ix_sfp_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sfp_permaticker ON public.sfp USING btree (permaticker);


--
-- Name: ix_sp500_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sp500_date ON public.sp500 USING btree (date);


--
-- Name: ix_sp500_permaticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sp500_permaticker ON public.sp500 USING btree (permaticker);


--
-- Name: ix_sp500_sector_weights_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sp500_sector_weights_date ON public.sp500_sector_weights USING btree (date);


--
-- Name: permaticker_lookup_product_ticker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX permaticker_lookup_product_ticker_idx ON public.permaticker_lookup USING btree (product, ticker);


--
-- Name: fred_observations fred_observations_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fred_observations
    ADD CONSTRAINT fred_observations_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.fred_series(series_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict RWav7hVzZmbWLkWVKFPZRaIZqEghELfuj46e0s74qYBF2a349115JcyYXu9ei7Q

