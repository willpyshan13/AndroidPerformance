package dev.androidperformance.compiler;

import org.jetbrains.kotlin.ir.expressions.IrStatementOrigin;
import org.jetbrains.kotlin.ir.expressions.IrBranch;
import org.jetbrains.kotlin.ir.expressions.IrContainerExpression;
import org.jetbrains.kotlin.ir.expressions.impl.IrCallImpl;
import org.jetbrains.kotlin.ir.expressions.impl.IrConstImpl;
import org.jetbrains.kotlin.ir.expressions.impl.IrBlockImpl;
import org.jetbrains.kotlin.ir.IrStatement;
import org.jetbrains.kotlin.ir.expressions.IrExpression;
import org.jetbrains.kotlin.ir.symbols.IrSimpleFunctionSymbol;
import org.jetbrains.kotlin.ir.types.IrType;
import org.jetbrains.kotlin.ir.util.IrElementConstructorIndicator;

/** Java bridge for IR constructors whose Kotlin metadata marks them as compiler-internal. */
public final class IrCalls {
    private IrCalls() {}

    public static IrCallImpl stringCall(int start, int end, IrType unitType, IrType stringType,
                                        IrSimpleFunctionSymbol function, String argument) {
        IrCallImpl call = new IrCallImpl(IrElementConstructorIndicator.INSTANCE, start, end,
                unitType, (IrStatementOrigin) null, function, null);
        call.putValueArgument(0, IrConstImpl.Companion.string(start, end, stringType, argument));
        return call;
    }

    public static void prependToBranch(IrBranch branch, IrStatement statement) {
        IrExpression result = branch.getResult();
        if (result instanceof IrContainerExpression) {
            ((IrContainerExpression) result).getStatements().add(0, statement);
            return;
        }
        IrBlockImpl block = new IrBlockImpl(IrElementConstructorIndicator.INSTANCE,
                result.getStartOffset(), result.getEndOffset(), result.getType(), (IrStatementOrigin) null);
        block.getStatements().add(statement);
        block.getStatements().add(result);
        branch.setResult(block);
    }
}
