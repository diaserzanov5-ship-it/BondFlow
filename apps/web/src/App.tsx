import { useMemo, useState } from 'react'
import './App.css'
import './hash.css'
import { hashCorporateAction, hashToHex } from './chain/eventHash'

type ActionStatus = 'Подготовлено' | 'Выплата доступна'
type CorporateAction = {
  id: string
  issuer: string
  bond: string
  kind: string
  date: string
  amount: string
  unit: string
  status: ActionStatus
  source: string
  sourceHash?: string
}
type PhantomProvider = {
  isPhantom?: boolean
  connect: () => Promise<{ publicKey: { toString: () => string } }>
  disconnect: () => Promise<void>
}
declare global { interface Window { solana?: PhantomProvider } }

const demoAction: CorporateAction = {
  id: 'BF-DEMO-001', issuer: 'BondFlow Demo Issuer', bond: 'KZ-DEMO-01',
  kind: 'Купонная выплата', date: '15 октября 2026', amount: '12 500',
  unit: 'TEST-KZT', status: 'Выплата доступна',
  source: 'Демонстрационные данные — не объявление KASE',
}

const navigation = ['Обзор', 'Корпоративные действия', 'Проверка записей']
const shortenAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`

function App() {
  const [actions, setActions] = useState<CorporateAction[]>([demoAction])
  const [activeView, setActiveView] = useState('Обзор')
  const [walletAddress, setWalletAddress] = useState('')
  const [walletError, setWalletError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({ bond: '', date: '', amount: '', source: '' })
  const claimableCount = useMemo(() => actions.filter((action) => action.status === 'Выплата доступна').length, [actions])

  async function connectWallet() {
    setWalletError('')
    if (!window.solana?.isPhantom) { setWalletError('Установите кошелёк Phantom, затем попробуйте снова.'); return }
    try {
      const response = await window.solana.connect()
      setWalletAddress(response.publicKey.toString())
    } catch { setWalletError('Подключение отменено или не удалось. Попробуйте ещё раз.') }
  }

  async function disconnectWallet() {
    await window.solana?.disconnect()
    setWalletAddress('')
  }

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    if (!form.bond.trim() || !form.date || !form.amount.trim()) { setFormError('Заполните тикер облигации, дату и сумму выплаты.'); return }
    const id = `BF-DEMO-${String(actions.length + 1).padStart(3, '0')}`
    const action: CorporateAction = {
      id,
      issuer: 'BondFlow Demo Issuer', bond: form.bond.trim().toUpperCase(), kind: 'Купонная выплата',
      date: new Date(`${form.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
      amount: form.amount.trim(), unit: 'TEST-KZT', status: 'Подготовлено',
      source: form.source.trim() || 'Источник не указан',
    }
    action.sourceHash = hashToHex(await hashCorporateAction(action))
    setActions((current) => [action, ...current])
    setForm({ bond: '', date: '', amount: '', source: '' })
    setModalOpen(false)
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="BondFlow, на главную"><span className="brand-mark"><i /><i /><i /></span><span>bond<span>flow</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <div className="workspace-switcher"><span className="workspace-avatar">B</span><span><strong>BondFlow Demo</strong><small>Issuer workspace</small></span><span className="chevron">⌄</span></div>
      <div className="nav-label">РАБОЧАЯ ОБЛАСТЬ</div>
      <nav className="main-nav" aria-label="Основная навигация">{navigation.map((item, index) => <button key={item} className={`nav-item ${activeView === item ? 'active' : ''}`} onClick={() => setActiveView(item)} type="button"><span className="nav-icon">{['⌂', '◷', '⌕'][index]}</span>{item}{index === 1 && <span className="nav-count">{actions.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="network-card"><span className="network-dot" /><span><strong>Solana Devnet</strong><small>Тестовая сеть</small></span></div>
        <a href="https://solana.com/docs" target="_blank" rel="noreferrer" className="help-link">Документация <span>↗</span></a>
        <div className="profile-row"><div className="profile-avatar">D</div><span><strong>Demo operator</strong><small>Operator</small></span><button className="icon-button" type="button" aria-label="Настройки профиля">•••</button></div>
      </div>
    </aside>

    <main className="main-content" id="overview">
      <header className="topbar"><div className="breadcrumbs"><span>BondFlow Demo</span><b>/</b><strong>{activeView}</strong></div><div className="topbar-actions"><span className="devnet-badge"><span /> DEVNET</span>{walletAddress ? <button className="wallet-button connected" onClick={disconnectWallet} type="button"><span className="wallet-indicator" />{shortenAddress(walletAddress)} <span className="button-caret">⌄</span></button> : <button className="wallet-button" onClick={connectWallet} type="button"><span className="wallet-icon">◈</span> Подключить кошелёк</button>}</div></header>

      <div className="page-wrap">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> CORPORATE ACTIONS</div><h1>Корпоративные действия</h1><p className="page-description">Управляйте купонными выплатами и проверяйте каждую запись.</p></div><button className="primary-button" onClick={() => setModalOpen(true)} type="button"><span>＋</span> Создать событие</button></div>

        <div className="demo-notice"><span className="notice-icon">i</span><p><strong>Демонстрационный режим.</strong> Данные вымышленные, транзакции и выплаты пока не отправляются в Solana.</p><span className="notice-tag">MVP PREVIEW</span></div>

        <section className="metrics-grid" aria-label="Сводка по событиям">
          <article className="metric-card"><div className="metric-top"><span>Всего событий</span><span className="metric-icon lavender">◷</span></div><div className="metric-value">{String(actions.length).padStart(2, '0')} <small>активных записей</small></div><div className="metric-foot"><span className="tiny-dot purple" /> В тестовом рабочем пространстве</div></article>
          <article className="metric-card"><div className="metric-top"><span>Ожидают выплаты</span><span className="metric-icon mint">↗</span></div><div className="metric-value">{String(claimableCount).padStart(2, '0')} <small>события</small></div><div className="metric-foot"><span className="tiny-dot green" /> Требуют действия держателя</div></article>
          <article className="metric-card"><div className="metric-top"><span>Зафиксировано в сети</span><span className="metric-icon blue">⌁</span></div><div className="metric-value">— <small>Devnet не подключён</small></div><div className="metric-foot muted-foot"><span className="tiny-dot gray" /> Появится после развёртывания программы</div></article>
        </section>

        <div className="section-heading"><div><h2>События по облигациям</h2><p>Купоны, погашения и другие действия эмитента</p></div><button className="subtle-button" type="button" onClick={() => setActiveView('Проверка записей')}>Журнал проверки <span>↗</span></button></div>
        <section className="action-list" aria-label="События по облигациям">{actions.map((action) => <article className="action-card" key={action.id}>
          <div className="action-date"><span className="date-month">{action.date.split(' ')[1]?.slice(0, 3).toUpperCase()}</span><strong>{action.date.split(' ')[0]}</strong><span>{action.date.split(' ')[2]}</span></div>
          <div className="action-main"><div className="action-title-row"><span className="action-kind-icon">◒</span><h3>{action.kind}</h3><span className={`status-pill ${action.status === 'Выплата доступна' ? 'status-open' : 'status-draft'}`}><i />{action.status}</span></div><div className="action-meta"><span>{action.issuer}</span><b>·</b><span>Облигация <strong>{action.bond}</strong></span><b>·</b><span className="action-id">{action.id}</span></div><div className="action-source"><span className="source-link-icon">↗</span>{action.source}</div>{action.sourceHash && <div className="hash-line"><span className="hash-dot" />SHA-256 <code>{action.sourceHash.slice(0, 16)}…</code><span>ещё не записан в сеть</span></div>}</div>
          <div className="action-amount"><span>К выплате</span><strong>{action.amount} <small>{action.unit}</small></strong><span className="amount-foot">Демонстрационное значение</span></div><button className="more-button" type="button" aria-label={`Подробнее: ${action.bond}`} onClick={() => setActiveView('Проверка записей')}>↗</button>
        </article>)}</section>

        <section className="bottom-grid">
          <article className="panel flow-panel"><div className="panel-heading"><div><h2>Как проходит выплата</h2><p>Путь события от эмитента к держателю</p></div><span className="panel-chip">4 шага</span></div><div className="flow-steps">
            <div className="flow-step done"><span className="step-number">01</span><span className="step-copy"><strong>Событие создано</strong><small>Описание и источник</small></span><span className="step-check">✓</span></div><div className="flow-connector" />
            <div className="flow-step done"><span className="step-number">02</span><span className="step-copy"><strong>Права рассчитаны</strong><small>Получатель и сумма</small></span><span className="step-check">✓</span></div><div className="flow-connector" />
            <div className="flow-step current"><span className="step-number">03</span><span className="step-copy"><strong>Запись в Solana</strong><small>Ожидает интеграции</small></span><span className="step-pending">···</span></div><div className="flow-connector" />
            <div className="flow-step"><span className="step-number">04</span><span className="step-copy"><strong>Выплата получена</strong><small>Проверяется в обозревателе</small></span><span className="step-lock">⌑</span></div>
          </div></article>
          <article className="panel verify-panel"><div className="panel-heading"><div><h2>Проверяемость</h2><p>Сверьте публикацию и запись</p></div><div className="verify-mark">⌁</div></div><div className="verify-placeholder"><div className="verify-orbit"><span>⌁</span></div><strong>Ожидает подключения Devnet</strong><p>После развёртывания программы здесь появятся хеш события и ссылка на транзакцию.</p></div><a className="external-link" href="https://kase.kz/en/information/corporate-events" target="_blank" rel="noreferrer">О корпоративных событиях KASE <span>↗</span></a></article>
        </section>
        <footer className="page-footer"><span>BondFlow <b>·</b> Prototype for Solana Devnet</span><span>Записи хранятся вне сети до публикации хеша</span></footer>
      </div>
    </main>

    {walletError && <div className="toast" role="status"><span>!</span>{walletError}<button type="button" onClick={() => setWalletError('')} aria-label="Закрыть">×</button></div>}
    {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false) }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> DEMO ACTION</span><h2 id="modal-title">Новое купонное событие</h2></div><button className="icon-button modal-close" onClick={() => setModalOpen(false)} type="button" aria-label="Закрыть">×</button></div>
      <p className="modal-description">Черновик будет добавлен только в интерфейс этого браузера. Он ещё не записан в блокчейн.</p>
      <form onSubmit={createDraft}><label>Тикер облигации<input value={form.bond} onChange={(event) => setForm({ ...form, bond: event.target.value })} placeholder="Например, KZ-DEMO-02" /></label>
        <div className="form-row"><label>Дата выплаты<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label><label>Сумма для кошелька<input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="12500" /></label></div>
        <label>Ссылка на источник<input type="url" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="https://…" /></label>
        <div className="modal-warning"><span>i</span><p>Используйте только демонстрационные данные. Не указывайте личные сведения или реальные суммы выплат.</p></div>
        {formError && <div className="form-error" role="alert">{formError}</div>}
        <div className="modal-actions"><button className="secondary-button" onClick={() => setModalOpen(false)} type="button">Отмена</button><button className="primary-button" type="submit">Добавить черновик</button></div>
      </form>
    </section></div>}
  </div>
}

export default App
