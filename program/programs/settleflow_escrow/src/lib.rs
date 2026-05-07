use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("Fg6PaFpoGXkYsidMpWxTWq3nx5pYQ5zL2q6T7qWtXrJ4");

#[program]
pub mod settleflow_escrow {
    use super::*;

    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        invoice_id: String,
        amount: u64,
    ) -> Result<()> {
        require!(invoice_id.len() <= 64, EscrowError::InvoiceIdTooLong);
        require!(amount > 0, EscrowError::InvalidAmount);

        let escrow = &mut ctx.accounts.escrow;
        escrow.invoice_id = invoice_id;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.escrow_token_account = ctx.accounts.escrow_token_account.key();
        escrow.amount = amount;
        escrow.funded_amount = 0;
        escrow.released = false;
        escrow.disputed = false;
        escrow.bump = ctx.bumps.escrow;
        Ok(())
    }

    pub fn fund_escrow(ctx: Context<FundEscrow>, amount: u64) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(!escrow.released, EscrowError::AlreadyReleased);
        require!(!escrow.disputed, EscrowError::EscrowDisputed);
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(
            escrow.funded_amount.saturating_add(amount) <= escrow.amount,
            EscrowError::Overfunded
        );

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.buyer_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        let cpi_context = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer_checked(cpi_context, amount, ctx.accounts.mint.decimals)?;

        escrow.funded_amount = escrow.funded_amount.saturating_add(amount);
        Ok(())
    }

    pub fn release_funds(ctx: Context<ReleaseFunds>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(!escrow.released, EscrowError::AlreadyReleased);
        require!(!escrow.disputed, EscrowError::EscrowDisputed);
        require!(escrow.funded_amount >= escrow.amount, EscrowError::NotFullyFunded);

        let invoice_id = escrow.invoice_id.as_bytes();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"escrow",
            invoice_id,
            escrow.buyer.as_ref(),
            &[escrow.bump],
        ]];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.seller_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer_checked(cpi_context, escrow.funded_amount, ctx.accounts.mint.decimals)?;

        escrow.released = true;
        Ok(())
    }

    pub fn dispute(ctx: Context<DisputeEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(!escrow.released, EscrowError::AlreadyReleased);
        escrow.disputed = true;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(invoice_id: String)]
pub struct InitializeEscrow<'info> {
    #[account(
        init,
        payer = buyer,
        space = 8 + EscrowAccount::INIT_SPACE,
        seeds = [b"escrow", invoice_id.as_bytes(), buyer.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// Seller wallet is stored once here and reused during release.
    pub seller: SystemAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = escrow_token_account.mint == mint.key(),
        constraint = escrow_token_account.owner == escrow.key()
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(
        mut,
        has_one = buyer,
        has_one = mint,
        has_one = escrow_token_account
    )]
    pub escrow: Account<'info, EscrowAccount>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = buyer_token_account.owner == buyer.key(),
        constraint = buyer_token_account.mint == mint.key()
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub escrow_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReleaseFunds<'info> {
    #[account(
        mut,
        has_one = buyer,
        has_one = mint,
        has_one = escrow_token_account
    )]
    pub escrow: Account<'info, EscrowAccount>,
    /// Buyer approves delivery and triggers release. Seller address is read from escrow state.
    pub buyer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = seller_token_account.owner == escrow.seller,
        constraint = seller_token_account.mint == mint.key()
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DisputeEscrow<'info> {
    #[account(mut, has_one = buyer)]
    pub escrow: Account<'info, EscrowAccount>,
    pub buyer: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    #[max_len(64)]
    pub invoice_id: String,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub escrow_token_account: Pubkey,
    pub amount: u64,
    pub funded_amount: u64,
    pub released: bool,
    pub disputed: bool,
    pub bump: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("Invoice id is too long.")]
    InvoiceIdTooLong,
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Escrow would be overfunded.")]
    Overfunded,
    #[msg("Escrow is not fully funded yet.")]
    NotFullyFunded,
    #[msg("Escrow has already been released.")]
    AlreadyReleased,
    #[msg("Escrow is disputed.")]
    EscrowDisputed,
}

// PDA usage:
// The escrow account is derived from ["escrow", invoice_id, buyer_pubkey].
// The seller pubkey is saved during initialize_escrow, so release_funds only
// receives the seller token account and validates its owner against escrow.seller.
