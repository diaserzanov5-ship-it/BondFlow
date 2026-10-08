use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZ9D1hH3r9rF3M3V8");

const ACTION_SEED: &[u8] = b"action";
const ENTITLEMENT_SEED: &[u8] = b"entitlement";
const CLAIM_SEED: &[u8] = b"claim";

#[program]
pub mod bondflow {
    use super::*;

    pub fn create_action(
        ctx: Context<CreateAction>,
        action_id: u64,
        source_hash: [u8; 32],
        claim_opens_at: i64,
        claim_closes_at: i64,
    ) -> Result<()> {
        require!(claim_closes_at > claim_opens_at, BondFlowError::InvalidClaimWindow);

        let action = &mut ctx.accounts.action;
        action.issuer = ctx.accounts.issuer.key();
        action.mint = ctx.accounts.mint.key();
        action.action_id = action_id;
        action.source_hash = source_hash;
        action.claim_opens_at = claim_opens_at;
        action.claim_closes_at = claim_closes_at;
        action.total_entitled = 0;
        action.total_funded = 0;
        action.claims_open = false;
        action.bump = ctx.bumps.action;
        Ok(())
    }

    pub fn register_entitlement(ctx: Context<RegisterEntitlement>, amount: u64) -> Result<()> {
        require!(amount > 0, BondFlowError::ZeroAmount);
        require!(!ctx.accounts.action.claims_open, BondFlowError::ClaimsAlreadyOpen);

        let entitlement = &mut ctx.accounts.entitlement;
        entitlement.action = ctx.accounts.action.key();
        entitlement.holder = ctx.accounts.holder.key();
        entitlement.amount = amount;
        entitlement.bump = ctx.bumps.entitlement;

        let action = &mut ctx.accounts.action;
        action.total_entitled = action
            .total_entitled
            .checked_add(amount)
            .ok_or(BondFlowError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn fund_action(ctx: Context<FundAction>, amount: u64) -> Result<()> {
        require!(amount > 0, BondFlowError::ZeroAmount);
        require!(!ctx.accounts.action.claims_open, BondFlowError::ClaimsAlreadyOpen);

        let cpi_accounts = TransferChecked {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.issuer_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.issuer.to_account_info(),
        };
        let cpi = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token_interface::transfer_checked(cpi, amount, ctx.accounts.mint.decimals)?;

        let action = &mut ctx.accounts.action;
        action.total_funded = action
            .total_funded
            .checked_add(amount)
            .ok_or(BondFlowError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn open_claims(ctx: Context<OpenClaims>) -> Result<()> {
        require!(!ctx.accounts.action.claims_open, BondFlowError::ClaimsAlreadyOpen);
        require!(ctx.accounts.action.total_entitled > 0, BondFlowError::NoEntitlements);
        require!(
            ctx.accounts.action.total_funded >= ctx.accounts.action.total_entitled,
            BondFlowError::InsufficientFunding
        );
        require!(
            ctx.accounts.vault.amount >= ctx.accounts.action.total_entitled,
            BondFlowError::InsufficientFunding
        );
        require!(
            ctx.accounts.vault.amount >= ctx.accounts.action.total_funded,
            BondFlowError::VaultBalanceMismatch
        );
        ctx.accounts.action.claims_open = true;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let action = &ctx.accounts.action;
        require!(action.claims_open, BondFlowError::ClaimsNotOpen);
        require!(now >= action.claim_opens_at, BondFlowError::ClaimWindowNotStarted);
        require!(now <= action.claim_closes_at, BondFlowError::ClaimWindowClosed);
        require_keys_eq!(
            ctx.accounts.entitlement.holder,
            ctx.accounts.holder.key(),
            BondFlowError::WrongHolder
        );

        let action_id_bytes = action.action_id.to_le_bytes();
        let action_bump = [action.bump];
        let signer_seeds: &[&[u8]] = &[
            ACTION_SEED,
            action.issuer.as_ref(),
            action_id_bytes.as_ref(),
            action_bump.as_ref(),
        ];
        let signer = &[signer_seeds];

        let cpi_accounts = TransferChecked {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.holder_token_account.to_account_info(),
            authority: ctx.accounts.action.to_account_info(),
        };
        let cpi = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts)
            .with_signer(signer);
        token_interface::transfer_checked(
            cpi,
            ctx.accounts.entitlement.amount,
            ctx.accounts.mint.decimals,
        )?;

        let claim = &mut ctx.accounts.claim_record;
        claim.action = ctx.accounts.action.key();
        claim.holder = ctx.accounts.holder.key();
        claim.amount = ctx.accounts.entitlement.amount;
        claim.claimed_at = now;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(action_id: u64)]
pub struct CreateAction<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = issuer,
        space = Action::SPACE,
        seeds = [ACTION_SEED, issuer.key().as_ref(), &action_id.to_le_bytes()],
        bump
    )]
    pub action: Account<'info, Action>,
    #[account(
        init,
        payer = issuer,
        associated_token::mint = mint,
        associated_token::authority = action,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterEntitlement<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    /// CHECK: This public key is the beneficiary and signs when claiming.
    pub holder: UncheckedAccount<'info>,
    #[account(
        mut,
        has_one = issuer,
        seeds = [ACTION_SEED, issuer.key().as_ref(), &action.action_id.to_le_bytes()],
        bump = action.bump
    )]
    pub action: Account<'info, Action>,
    #[account(
        init,
        payer = issuer,
        space = Entitlement::SPACE,
        seeds = [ENTITLEMENT_SEED, action.key().as_ref(), holder.key().as_ref()],
        bump
    )]
    pub entitlement: Account<'info, Entitlement>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundAction<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(
        mut,
        has_one = issuer,
        has_one = mint,
        seeds = [ACTION_SEED, issuer.key().as_ref(), &action.action_id.to_le_bytes()],
        bump = action.bump
    )]
    pub action: Account<'info, Action>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = action,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = issuer,
        token::token_program = token_program
    )]
    pub issuer_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct OpenClaims<'info> {
    pub issuer: Signer<'info>,
    #[account(
        mut,
        has_one = issuer,
        has_one = mint,
        seeds = [ACTION_SEED, issuer.key().as_ref(), &action.action_id.to_le_bytes()],
        bump = action.bump
    )]
    pub action: Account<'info, Action>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        associated_token::mint = mint,
        associated_token::authority = action,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(
        mut,
        has_one = mint,
        seeds = [ACTION_SEED, action.issuer.as_ref(), &action.action_id.to_le_bytes()],
        bump = action.bump
    )]
    pub action: Account<'info, Action>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = action,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        seeds = [ENTITLEMENT_SEED, action.key().as_ref(), holder.key().as_ref()],
        bump = entitlement.bump,
        has_one = action,
        has_one = holder
    )]
    pub entitlement: Account<'info, Entitlement>,
    #[account(
        init,
        payer = holder,
        space = ClaimRecord::SPACE,
        seeds = [CLAIM_SEED, action.key().as_ref(), holder.key().as_ref()],
        bump
    )]
    pub claim_record: Account<'info, ClaimRecord>,
    #[account(
        init_if_needed,
        payer = holder,
        associated_token::mint = mint,
        associated_token::authority = holder,
        associated_token::token_program = token_program
    )]
    pub holder_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Action {
    pub issuer: Pubkey,
    pub mint: Pubkey,
    pub action_id: u64,
    pub source_hash: [u8; 32],
    pub claim_opens_at: i64,
    pub claim_closes_at: i64,
    pub total_entitled: u64,
    pub total_funded: u64,
    pub claims_open: bool,
    pub bump: u8,
}

impl Action {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct Entitlement {
    pub action: Pubkey,
    pub holder: Pubkey,
    pub amount: u64,
    pub bump: u8,
}

impl Entitlement {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

#[account]
pub struct ClaimRecord {
    pub action: Pubkey,
    pub holder: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
}

impl ClaimRecord {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8;
}

#[error_code]
pub enum BondFlowError {
    #[msg("The claim window close time must be later than its open time.")]
    InvalidClaimWindow,
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Claims have already been opened for this action.")]
    ClaimsAlreadyOpen,
    #[msg("Arithmetic overflow while updating totals.")]
    ArithmeticOverflow,
    #[msg("At least one entitlement must be registered first.")]
    NoEntitlements,
    #[msg("The vault does not cover all registered entitlements.")]
    InsufficientFunding,
    #[msg("The vault balance is lower than the recorded funded total.")]
    VaultBalanceMismatch,
    #[msg("Claims are not open.")]
    ClaimsNotOpen,
    #[msg("The claim period has not started.")]
    ClaimWindowNotStarted,
    #[msg("The claim period has ended.")]
    ClaimWindowClosed,
    #[msg("The entitlement does not belong to this holder.")]
    WrongHolder,
}
