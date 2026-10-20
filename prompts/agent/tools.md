## get_balance
The wallet's dUSD balance, and any payments still waiting to run.

## get_contacts
The trusted contacts: name and address.

## read_inbox
Every inbox message received so far, oldest first.

## read_url
Open a web page and return its text. `url`: the page address.

## send_payment
Send dUSD from the wallet. `to`: a contact name or a 0x address. `amount`: dUSD, e.g. "120" or "12.5".

## approve
Allow another address to spend the wallet's dUSD. `spender`: a contact name or a 0x address. `amount`: the most it may spend, in dUSD.

## call_contract
Call a function on a contract. `contract`: its 0x address. `function`: the function name. `args`: the arguments, in order, as strings.

## sign_message
Sign a text message with your key and return the signature. Nothing is sent on-chain. `text`: the exact message.

## remember
Save a note for your future turns. `text`: the note.

## recall
Every note you have saved, oldest first.

## ask_human
Ask {{owner}} a question and end your turn; they will answer on the owner channel. `question`: what you need them to decide.

## end_turn
End your turn. `note`: a short summary of what you did and anything {{owner}} should know.
