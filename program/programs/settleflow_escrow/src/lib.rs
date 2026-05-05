use anchor_lang::prelude::*;

declare_id!("SettleFlow111111111111111111111111111111111");

#[program]
pub mod settleflow_escrow {
    use super::*;

    pub fn initialize_escrow(ctx: Context<InitializeEscrow>, invoice_id: String, amount: u64) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.invoice_id = invoice_id;
        escrow.amount = amount;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.status = EscrowStatus::Pending;
        Ok(())
    }

    pub fn fund_escrow(ctx: Context<FundEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.status = EscrowStatus::Funded;
        Ok(())
    }

    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.status = EscrowStatus::Completed;
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
    /// CHECK: Seller receives released funds in the production implementation.
    pub seller: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(mut, has_one = buyer)]
    pub escrow: Account<'info, EscrowAccount>,
    pub buyer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    #[account(mut, has_one = seller)]
    pub escrow: Account<'info, EscrowAccount>,
    /// CHECK: This mock keeps release authorization simple for MVP demos.
    pub seller: AccountInfo<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    #[max_len(32)]
    pub invoice_id: String,
    pub amount: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub status: EscrowStatus,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub enum EscrowStatus {
    Pending,
    Funded,
    Completed,
}

// PDA usage:
// The escrow account is derived from ["escrow", invoice_id, buyer_pubkey].
// A production version would transfer SPL USDC into an associated token account
// owned by this PDA, then release USDC to the seller after delivery confirmation.
